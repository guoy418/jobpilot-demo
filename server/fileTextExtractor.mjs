import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { ocrImageWithOptionalAi, transcribeAudioWithOptionalAi } from "./aiProvider.mjs";
import { decodeTextFileSync } from "./textEncoding.mjs";

const TEXT_LIMIT = 250_000;

const compact = (value = "") => String(value ?? "").trim();

const mimeTypeForPath = (filePath = "") => {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith(".pdf")) return "application/pdf";
  if (lowerPath.endsWith(".png")) return "image/png";
  if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) return "image/jpeg";
  if (lowerPath.endsWith(".webp")) return "image/webp";
  if (lowerPath.endsWith(".gif")) return "image/gif";
  if (lowerPath.endsWith(".mp3")) return "audio/mpeg";
  if (lowerPath.endsWith(".m4a")) return "audio/mp4";
  if (lowerPath.endsWith(".wav")) return "audio/wav";
  if (lowerPath.endsWith(".aac")) return "audio/aac";
  if (lowerPath.endsWith(".ogg")) return "audio/ogg";
  if (lowerPath.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lowerPath.endsWith(".md") || lowerPath.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
};

const isTextFile = (filePath) => /\.(txt|md)$/i.test(filePath);
const isPdfFile = (filePath) => /\.pdf$/i.test(filePath);
const isDocxFile = (filePath) => /\.docx$/i.test(filePath);
const isImageFile = (filePath) => /\.(png|jpe?g|webp|gif)$/i.test(filePath);
const isAudioFile = (filePath) => /\.(m4a|mp3|wav|aac|ogg)$/i.test(filePath);

const truncateText = (text) => compact(text).slice(0, TEXT_LIMIT);

const extractPdfText = async (filePath) => {
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });
  try {
    const result = await parser.getText();
    return truncateText(result.text);
  } finally {
    await parser.destroy();
  }
};

const extractDocxText = async (filePath) => {
  const result = await mammoth.extractRawText({ path: filePath });
  return truncateText(result.value);
};

const fallbackSourceNote = (payload, reason, extractionError = "") => ({
  ...payload,
  extractionStatus: reason,
  extractionError: compact(extractionError),
});

export const hydrateParsePayload = async (payload, getFilePath) => {
  if (compact(payload.rawText)) return payload;
  const storageUri = compact(payload.storageUri);
  if (!storageUri.startsWith("/api/files/")) return payload;

  const storedFileName = storageUri.split("/").pop();
  if (!storedFileName) return payload;
  const filePath = getFilePath(storedFileName);
  if (!filePath) return fallbackSourceNote(payload, "stored-file-missing");

  try {
    if (isTextFile(filePath)) {
      const decoded = decodeTextFileSync(filePath);
      if (decoded.garbled) {
        return fallbackSourceNote(
          payload,
          "text-encoding-failed",
          "文本文件编码无法识别，看起来像乱码。请用 UTF-8 重新导出转写稿，或直接粘贴文字内容。",
        );
      }
      return {
        ...payload,
        rawText: truncateText(decoded.text),
        extractionStatus: "local-text",
      };
    }

    if (isPdfFile(filePath)) {
      const rawText = await extractPdfText(filePath);
      return rawText ? { ...payload, rawText, extractionStatus: "local-pdf-text" } : fallbackSourceNote(payload, "empty-pdf-text");
    }

    if (isDocxFile(filePath)) {
      const rawText = await extractDocxText(filePath);
      return rawText ? { ...payload, rawText, extractionStatus: "local-docx-text" } : fallbackSourceNote(payload, "empty-docx-text");
    }

    if (isImageFile(filePath)) {
      const result = await ocrImageWithOptionalAi(payload, {
        path: filePath,
        fileName: compact(payload.fileName) || path.basename(filePath),
        mimeType: mimeTypeForPath(filePath),
        buffer: fs.readFileSync(filePath),
      });
      return result.text
        ? { ...payload, rawText: truncateText(result.text), extractionStatus: result.status || "ai-ocr", extractionError: "" }
        : fallbackSourceNote(payload, result.status || "ocr-unavailable", result.error);
    }

    if (isAudioFile(filePath)) {
      const result = await transcribeAudioWithOptionalAi(payload, {
        path: filePath,
        fileName: compact(payload.fileName) || path.basename(filePath),
        mimeType: mimeTypeForPath(filePath),
      });
      return result.text
        ? { ...payload, rawText: truncateText(result.text), extractionStatus: result.status || "ai-transcription", extractionError: "" }
        : fallbackSourceNote(payload, result.status || "transcription-unavailable", result.error);
    }

    return fallbackSourceNote(payload, "unsupported-file-type");
  } catch (error) {
    console.warn(`[FILE TEXT FALLBACK] ${error instanceof Error ? error.message : String(error)}`);
    return fallbackSourceNote(payload, "file-extraction-failed");
  }
};
