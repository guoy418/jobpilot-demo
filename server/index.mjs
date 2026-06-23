import http from "node:http";
import fs from "node:fs";
import { parseWithOptionalAi } from "./aiProvider.mjs";
import { createRepository, openDatabase } from "./db.mjs";
import { hydrateParsePayload } from "./fileTextExtractor.mjs";
import { parseInterviewDraft, parseOpportunityDraft, parseResumeDraft } from "./parser.mjs";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";

const db = openDatabase();
const repo = createRepository(db);

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
};

const sendNotFound = (res, path) =>
  sendJson(res, 404, {
    error: "not_found",
    path,
  });

const getPathParts = (url) => url.pathname.split("/").filter(Boolean);

const contentTypeFor = (filePath) => {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith(".pdf")) return "application/pdf";
  if (lowerPath.endsWith(".png")) return "image/png";
  if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) return "image/jpeg";
  if (lowerPath.endsWith(".webp")) return "image/webp";
  if (lowerPath.endsWith(".gif")) return "image/gif";
  if (lowerPath.endsWith(".mp3")) return "audio/mpeg";
  if (lowerPath.endsWith(".m4a")) return "audio/mp4";
  if (lowerPath.endsWith(".wav")) return "audio/wav";
  if (lowerPath.endsWith(".md") || lowerPath.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
};

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody.trim()) return {};
  return JSON.parse(rawBody);
};

const handleGet = (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  const parts = getPathParts(url);

  if (url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      dbPath: repo.dbPath,
    });
  }

  if (parts[0] === "api" && parts[1] === "files" && parts[2]) {
    const filePath = repo.getFilePath(parts[2]);
    if (!filePath) return sendNotFound(res, url.pathname);
    res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Access-Control-Allow-Origin": "*",
      "Content-Disposition": `inline; filename="${encodeURIComponent(parts[2])}"`,
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (url.pathname === "/api/opportunities") return sendJson(res, 200, repo.listOpportunities());
  if (parts[0] === "api" && parts[1] === "opportunities" && parts[2]) {
    const opportunityId = decodeURIComponent(parts[2]);
    if (parts.length === 3) {
      const opportunity = repo.getOpportunity(opportunityId);
      return opportunity ? sendJson(res, 200, opportunity) : sendNotFound(res, url.pathname);
    }
    if (parts[3] === "source-assets") return sendJson(res, 200, repo.listOpportunitySourceAssets(opportunityId));
    if (parts[3] === "timeline") return sendJson(res, 200, repo.listOpportunityTimeline(opportunityId));
    if (parts[3] === "pipeline") {
      const pipeline = repo.getOpportunityPipeline(opportunityId);
      return pipeline ? sendJson(res, 200, pipeline) : sendNotFound(res, url.pathname);
    }
  }

  if (url.pathname === "/api/interviews") return sendJson(res, 200, repo.listInterviews());
  if (parts[0] === "api" && parts[1] === "interviews" && parts[2]) {
    const interviewId = decodeURIComponent(parts[2]);
    if (parts.length === 3) {
      const interview = repo.getInterview(interviewId);
      return interview ? sendJson(res, 200, interview) : sendNotFound(res, url.pathname);
    }
  }
  if (url.pathname === "/api/answers") return sendJson(res, 200, repo.listAnswers());
  if (url.pathname === "/api/answer-categories") return sendJson(res, 200, repo.listAnswerCategories());
  if (url.pathname === "/api/resumes") return sendJson(res, 200, repo.listResumes());
  if (parts[0] === "api" && parts[1] === "resumes" && parts[2]) {
    const resumeId = decodeURIComponent(parts[2]);
    if (parts.length === 3) {
      const resume = repo.getResume(resumeId);
      return resume ? sendJson(res, 200, resume) : sendNotFound(res, url.pathname);
    }
    if (parts[3] === "linked-opportunities") return sendJson(res, 200, repo.listResumeLinkedOpportunities(resumeId));
  }
  if (url.pathname === "/api/weekly-plan/current") return sendJson(res, 200, repo.getCurrentWeeklyPlan());
  if (url.pathname === "/api/dashboard/summary") return sendJson(res, 200, repo.getDashboardSummary());
  if (url.pathname === "/api/dashboard/today-actions") return sendJson(res, 200, repo.getTodayActions());
  if (url.pathname === "/api/backup") return sendJson(res, 200, repo.createBackup());

  return sendNotFound(res, url.pathname);
};

const handleWrite = async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  const parts = getPathParts(url);

  if (url.pathname === "/api/answers" && req.method === "POST") {
    const payload = await readJsonBody(req);
    const answer = repo.createAnswer(payload);
    return sendJson(res, 201, answer);
  }

  if (url.pathname === "/api/answer-categories" && req.method === "POST") {
    const payload = await readJsonBody(req);
    const category = repo.createAnswerCategory(payload);
    return sendJson(res, 201, category);
  }

  if (url.pathname === "/api/weekly-plan/current" && req.method === "PATCH") {
    const payload = await readJsonBody(req);
    const weeklyPlan = repo.updateCurrentWeeklyPlan(payload);
    return weeklyPlan ? sendJson(res, 200, weeklyPlan) : sendNotFound(res, url.pathname);
  }

  if (url.pathname === "/api/weekly-plan/current/tasks" && req.method === "POST") {
    const payload = await readJsonBody(req);
    const task = repo.createWeeklyTask(payload);
    return task ? sendJson(res, 201, task) : sendNotFound(res, url.pathname);
  }

  if (url.pathname === "/api/resumes" && req.method === "POST") {
    const payload = await readJsonBody(req);
    const resume = repo.createResume(payload);
    return sendJson(res, 201, resume);
  }

  if (url.pathname === "/api/interviews" && req.method === "POST") {
    const payload = await readJsonBody(req);
    const interview = repo.createInterview(payload);
    return sendJson(res, 201, interview);
  }

  if (url.pathname === "/api/opportunities" && req.method === "POST") {
    const payload = await readJsonBody(req);
    const opportunity = repo.createOpportunity(payload);
    return sendJson(res, 201, opportunity);
  }

  if (url.pathname === "/api/files" && req.method === "POST") {
    const payload = await readJsonBody(req);
    const file = repo.saveFile(payload);
    return sendJson(res, 201, file);
  }

  if (parts[0] === "api" && parts[1] === "parse" && req.method === "POST") {
    const kind = parts[2];
    const payload = await hydrateParsePayload(await readJsonBody(req), repo.getFilePath);
    if (kind === "opportunity") {
      const fallback = parseOpportunityDraft(payload);
      return sendJson(res, 200, await parseWithOptionalAi(kind, payload, fallback));
    }
    if (kind === "interview") {
      const fallback = parseInterviewDraft(payload);
      return sendJson(res, 200, await parseWithOptionalAi(kind, payload, fallback));
    }
    if (kind === "resume") {
      const fallback = parseResumeDraft(payload);
      return sendJson(res, 200, await parseWithOptionalAi(kind, payload, fallback));
    }
    return sendNotFound(res, url.pathname);
  }

  if (url.pathname === "/api/backup" && req.method === "POST") {
    const payload = await readJsonBody(req);
    const backup = repo.restoreBackup(payload);
    return sendJson(res, 200, backup);
  }

  if (parts[0] === "api" && parts[1] === "answers" && parts[2]) {
    const answerId = decodeURIComponent(parts[2]);
    if (req.method === "PATCH") {
      const payload = await readJsonBody(req);
      const answer = repo.updateAnswer(answerId, payload);
      return answer ? sendJson(res, 200, answer) : sendNotFound(res, url.pathname);
    }
    if (req.method === "DELETE") {
      const deleted = repo.deleteAnswer(answerId);
      return deleted ? sendJson(res, 200, { ok: true, id: answerId }) : sendNotFound(res, url.pathname);
    }
  }

  if (parts[0] === "api" && parts[1] === "answer-categories" && parts[2]) {
    const categoryId = decodeURIComponent(parts[2]);
    if (req.method === "PATCH") {
      const payload = await readJsonBody(req);
      const category = repo.updateAnswerCategory(categoryId, payload);
      return category ? sendJson(res, 200, category) : sendNotFound(res, url.pathname);
    }
    if (req.method === "DELETE") {
      const deleted = repo.deleteAnswerCategory(categoryId);
      return deleted ? sendJson(res, 200, { ok: true, id: categoryId }) : sendNotFound(res, url.pathname);
    }
  }

  if (parts[0] === "api" && parts[1] === "weekly-tasks" && parts[2]) {
    const taskId = decodeURIComponent(parts[2]);
    if (req.method === "PATCH") {
      const payload = await readJsonBody(req);
      const task = repo.updateWeeklyTask(taskId, payload);
      return task ? sendJson(res, 200, task) : sendNotFound(res, url.pathname);
    }
    if (req.method === "DELETE") {
      const deleted = repo.deleteWeeklyTask(taskId);
      return deleted ? sendJson(res, 200, { ok: true, id: taskId }) : sendNotFound(res, url.pathname);
    }
  }

  if (parts[0] === "api" && parts[1] === "resumes" && parts[2]) {
    const resumeId = decodeURIComponent(parts[2]);
    if (req.method === "PATCH") {
      const payload = await readJsonBody(req);
      const resume = repo.updateResume(resumeId, payload);
      return resume ? sendJson(res, 200, resume) : sendNotFound(res, url.pathname);
    }
    if (req.method === "DELETE") {
      const deleted = repo.deleteResume(resumeId);
      return deleted ? sendJson(res, 200, { ok: true, id: resumeId }) : sendNotFound(res, url.pathname);
    }
  }

  if (parts[0] === "api" && parts[1] === "interviews" && parts[2]) {
    const interviewId = decodeURIComponent(parts[2]);
    if (parts[3] === "qa" && req.method === "POST") {
      const payload = await readJsonBody(req);
      const qaPair = repo.createQaPair(interviewId, payload);
      return qaPair ? sendJson(res, 201, qaPair) : sendNotFound(res, url.pathname);
    }
    if (req.method === "PATCH") {
      const payload = await readJsonBody(req);
      const interview = repo.updateInterview(interviewId, payload);
      return interview ? sendJson(res, 200, interview) : sendNotFound(res, url.pathname);
    }
    if (req.method === "DELETE") {
      const deleted = repo.deleteInterview(interviewId);
      return deleted ? sendJson(res, 200, { ok: true, id: interviewId }) : sendNotFound(res, url.pathname);
    }
  }

  if (parts[0] === "api" && parts[1] === "qa-pairs" && parts[2]) {
    const qaPairId = decodeURIComponent(parts[2]);
    if (parts[3] === "create-answer-card" && req.method === "POST") {
      const answer = repo.createAnswerFromQaPair(qaPairId);
      return answer ? sendJson(res, 200, answer) : sendNotFound(res, url.pathname);
    }
    if (req.method === "PATCH") {
      const payload = await readJsonBody(req);
      const qaPair = repo.updateQaPair(qaPairId, payload);
      return qaPair ? sendJson(res, 200, qaPair) : sendNotFound(res, url.pathname);
    }
    if (req.method === "DELETE") {
      const deleted = repo.deleteQaPair(qaPairId);
      return deleted ? sendJson(res, 200, { ok: true, id: qaPairId }) : sendNotFound(res, url.pathname);
    }
  }

  if (parts[0] === "api" && parts[1] === "opportunities" && parts[2]) {
    const opportunityId = decodeURIComponent(parts[2]);
    if (parts[3] === "progress" && req.method === "POST") {
      const payload = await readJsonBody(req);
      const opportunity = repo.addOpportunityProgress(opportunityId, payload);
      return opportunity ? sendJson(res, 200, opportunity) : sendNotFound(res, url.pathname);
    }
    if (req.method === "PATCH") {
      const payload = await readJsonBody(req);
      const opportunity = repo.updateOpportunity(opportunityId, payload);
      return opportunity ? sendJson(res, 200, opportunity) : sendNotFound(res, url.pathname);
    }
    if (req.method === "DELETE") {
      const deleted = repo.deleteOpportunity(opportunityId);
      return deleted ? sendJson(res, 200, { ok: true, id: opportunityId }) : sendNotFound(res, url.pathname);
    }
  }

  return sendJson(res, 405, {
    error: "method_not_allowed",
    method: req.method,
    message: "This write endpoint is not implemented yet.",
  });
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});

  try {
    if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
      return await handleWrite(req, res);
    }
    if (req.method !== "GET") {
      return sendJson(res, 405, {
        error: "method_not_allowed",
        method: req.method,
      });
    }
    return handleGet(req, res);
  } catch (error) {
    console.error(error);
    const isBackupValidationError = error?.name === "BackupValidationError";
    return sendJson(res, isBackupValidationError ? 400 : 500, {
      error: isBackupValidationError ? "invalid_backup" : "internal_server_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`JobPilot local API listening at http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${repo.dbPath}`);
});
