import { describe, expect, it } from "vitest";
import { BACKUP_SCHEMA_VERSION, BackupValidationError, migrateBackupPayload, validateBackupPayload } from "./backupValidation.mjs";

const validBackup = () => ({
  schemaVersion: BACKUP_SCHEMA_VERSION,
  exportedAt: "2026-06-23T00:00:00.000Z",
  source: "test",
  resumeVersions: [
    {
      id: "RV-1",
      name: "Resume",
      fileName: "resume.pdf",
      fileType: "PDF",
      fileSize: "1 KB",
      uploadedAt: "Today",
      roles: "Frontend",
      points: "React",
      summary: "Test resume",
    },
  ],
  opportunities: [
    {
      id: "OP-1",
      title: "Frontend Intern",
      company: "Example",
      status: "TO APPLY",
      priority: "A",
      match: "HIGH",
      action: "P0",
      city: "Shanghai",
      deadline: "Tomorrow",
      resumeId: "RV-1",
      nextAction: "Apply",
      jdSummary: "Summary",
      jdText: "JD",
      sourceAssets: [],
      timeline: [{ id: "TL-1", occurredAt: "Next", title: "Apply", detail: "", status: "next" }],
    },
  ],
  interviewSessions: [
    {
      id: "INT-1",
      opportunityId: "OP-1",
      company: "Example",
      role: "Frontend Intern",
      round: "Round 1",
      date: "Today",
      reviewPriority: "P1",
      sourceFiles: [],
      qaPairs: [
        {
          id: "QA-1",
          question: "Question",
          originalAnswer: "Answer",
          type: "TECHNICAL",
          score: 3,
          critique: "Critique",
          weak: false,
          framework: "STAR",
          optimizedAnswer: "Better answer",
        },
      ],
    },
  ],
  answerCategories: [{ id: "CAT-1", name: "General", sortOrder: 0, system: false }],
  answerCards: [
    {
      id: "AC-1",
      question: "Question",
      type: "TECHNICAL",
      status: "ACTIVE",
      source: "Interview",
      sourceQaPairId: "QA-1",
      categoryId: "CAT-1",
      framework: "STAR",
      answer: "Better answer",
      relatedRoles: "Frontend",
      practiceStatus: "中等",
    },
  ],
  weeklyPlan: {
    weekStart: "2026-06-22",
    targetApplications: 3,
    focusDirections: ["Frontend"],
    focusCities: ["Shanghai"],
    focusCompanies: ["Example"],
    practiceThemes: ["Projects"],
    tasks: [
      {
        id: "WT-1",
        title: "Practice",
        detail: "Practice answer",
        source: "answer",
        sourceLabel: "Answer bank",
        relatedEntityId: "AC-1",
        status: "open",
      },
    ],
  },
  storedFiles: [
    {
      storageUri: "/api/files/test.txt",
      fileName: "test.txt",
      fileSize: "4 B",
      dataBase64: Buffer.from("test", "utf8").toString("base64"),
    },
  ],
});

describe("backup payload validation", () => {
  it("passes the current backup version through migration unchanged", () => {
    const backup = validBackup();

    expect(migrateBackupPayload(backup)).toBe(backup);
  });

  it("validates a complete backup and returns restore counts", () => {
    expect(validateBackupPayload(validBackup()).summary).toEqual({
      opportunities: 1,
      resumes: 1,
      interviews: 1,
      answerCards: 1,
      weeklyTasks: 1,
    });
  });

  it("migrates a legacy backup to the current schema before validation", () => {
    const backup = validBackup();
    backup.schemaVersion = "jobpilot-v0.7";
    delete backup.exportedAt;
    delete backup.source;
    delete backup.answerCategories;
    delete backup.answerCards[0].categoryId;
    delete backup.weeklyPlan.focusCities;
    delete backup.weeklyPlan.focusCompanies;
    delete backup.weeklyPlan.practiceThemes;
    delete backup.storedFiles;

    const result = validateBackupPayload(backup);

    expect(result.summary).toEqual({
      opportunities: 1,
      resumes: 1,
      interviews: 1,
      answerCards: 1,
      weeklyTasks: 1,
    });
    expect(result.data.answerCategories.map((category) => category.id)).toContain("CAT-UNCATEGORIZED");
    expect(result.data.answerCards[0].categoryId).toBe("CAT-UNCATEGORIZED");
    expect(result.data.storedFiles).toEqual([]);
    expect(result.data.weeklyPlan.focusCities).toEqual([]);
  });

  it("rejects invalid references after legacy migration", () => {
    const backup = validBackup();
    backup.schemaVersion = "jobpilot-v0.7";
    delete backup.answerCategories;
    backup.answerCards[0].categoryId = "CAT-MISSING";

    expect(() => validateBackupPayload(backup)).toThrow(BackupValidationError);
  });

  it("rejects invalid references before restore can mutate data", () => {
    const backup = validBackup();
    backup.answerCards[0].categoryId = "CAT-MISSING";

    expect(() => validateBackupPayload(backup)).toThrow(BackupValidationError);
  });

  it("rejects unsupported schema versions", () => {
    expect(() => validateBackupPayload({ ...validBackup(), schemaVersion: "jobpilot-v0.1" })).toThrow(BackupValidationError);
  });
});
