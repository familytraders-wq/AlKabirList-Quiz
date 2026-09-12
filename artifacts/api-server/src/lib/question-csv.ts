import { parse as parseCsv } from "csv-parse/sync";

export const QUESTION_IMPORT_HEADERS = [
  "question_id",
  "expected_version",
  "prompt",
  "explanation",
  "type",
  "points",
  "choice_1",
  "choice_1_correct",
  "choice_2",
  "choice_2_correct",
  "choice_3",
  "choice_3_correct",
  "choice_4",
  "choice_4_correct",
  "source_title",
  "source_url",
  "category_id",
  "difficulty_id",
  "audience_ids",
] as const;

export const CSV_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_IMPORT_MAX_ROWS = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ImportRowError = { row: number; column: string; message: string };
export type ImportTaxonomyRef = { row: number; column: string; id: string; kind: "category" | "difficulty" | "audience" };
export type QuestionInput = {
  row?: number;
  questionId?: string;
  expectedVersion?: number;
  categoryId?: string;
  difficultyId?: string;
  audienceIds?: string[];
  prompt: string;
  explanation: string;
  type?: "multiple_choice" | "true_false";
  points?: number;
  choices: Array<{ label: string; position: number; isCorrect: boolean }>;
  sourceMetadata: Array<{ title: string; url?: string }>;
};

export type QuestionCsvExportRow = {
  questionId: string;
  expectedVersion: number;
  prompt: string;
  explanation: string;
  type: "multiple_choice" | "true_false";
  points: number;
  choices: Array<{ label: string; position: number; isCorrect: boolean }>;
  sourceMetadata: Array<{ title: string; url?: string }>;
  categoryId?: string | null;
  difficultyId?: string | null;
  audienceIds: string[];
};

export type ParsedQuestionCsv = {
  inputs: QuestionInput[];
  rowErrors: ImportRowError[];
  taxonomyRefs: ImportTaxonomyRef[];
};

function csvCell(value: string | number | boolean | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeQuestionCsv(rows: QuestionCsvExportRow[]) {
  const lines = [QUESTION_IMPORT_HEADERS.join(",")];
  for (const row of rows) {
    const choices = Array.from({ length: 4 }, (_, index) => row.choices[index]);
    const source = row.sourceMetadata[0];
    lines.push([
      row.questionId,
      row.expectedVersion,
      row.prompt,
      row.explanation,
      row.type,
      row.points,
      choices[0]?.label,
      choices[0]?.isCorrect ?? false,
      choices[1]?.label,
      choices[1]?.isCorrect ?? false,
      choices[2]?.label,
      choices[2]?.isCorrect ?? false,
      choices[3]?.label,
      choices[3]?.isCorrect ?? false,
      source?.title,
      source?.url,
      row.categoryId,
      row.difficultyId,
      row.audienceIds.join(";"),
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function normalizedPrompt(prompt: string) {
  return prompt.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function parseQuestionCsv(csv: string): ParsedQuestionCsv {
  let records: string[][];
  try {
    records = parseCsv(csv, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: false,
    }) as string[][];
  } catch {
    return {
      inputs: [],
      taxonomyRefs: [],
      rowErrors: [{ row: 1, column: "csv", message: "Malformed CSV quoting or syntax" }],
    };
  }

  if (!records.length || !records[0]?.some((cell) => cell.length > 0)) {
    return {
      inputs: [],
      taxonomyRefs: [],
      rowErrors: [{ row: 1, column: "csv", message: "The CSV file is blank" }],
    };
  }

  const header = records[0] ?? [];
  const rowErrors: ImportRowError[] = [];
  const expectedHeader = [...QUESTION_IMPORT_HEADERS];
  const duplicateHeaders = header.filter((value, index) => header.indexOf(value) !== index);
  if (
    duplicateHeaders.length ||
    header.length !== expectedHeader.length ||
    header.some((value, index) => value !== expectedHeader[index])
  ) {
    return {
      inputs: [],
      taxonomyRefs: [],
      rowErrors: [{
        row: 1,
        column: "header",
        message: "Header must exactly match the documented CSV template with no missing, extra, or duplicate columns",
      }],
    };
  }

  const dataRows = records.slice(1);
  if (!dataRows.length) {
    return {
      inputs: [],
      taxonomyRefs: [],
      rowErrors: [{ row: 2, column: "csv", message: "The CSV file must contain at least one data row" }],
    };
  }
  if (dataRows.length > CSV_IMPORT_MAX_ROWS) {
    return {
      inputs: [],
      taxonomyRefs: [],
      rowErrors: [{
        row: CSV_IMPORT_MAX_ROWS + 2,
        column: "csv",
        message: `A maximum of ${CSV_IMPORT_MAX_ROWS} data rows is allowed`,
      }],
    };
  }

  const inputs: QuestionInput[] = [];
  const taxonomyRefs: ImportTaxonomyRef[] = [];
  const seenPrompts = new Map<string, number>();
  const seenQuestionIds = new Map<string, number>();
  const addError = (row: number, column: string, message: string) => rowErrors.push({ row, column, message });

  dataRows.forEach((record, index) => {
    const row = index + 2;
    if (record.length !== QUESTION_IMPORT_HEADERS.length) {
      addError(row, "csv", `Expected exactly ${QUESTION_IMPORT_HEADERS.length} columns`);
      return;
    }
    const values = Object.fromEntries(
      QUESTION_IMPORT_HEADERS.map((column, columnIndex) => [column, record[columnIndex] ?? ""]),
    ) as Record<(typeof QUESTION_IMPORT_HEADERS)[number], string>;
    const questionId = values.question_id.trim();
    const expectedVersionText = values.expected_version.trim();
    if (questionId && !UUID_PATTERN.test(questionId)) {
      addError(row, "question_id", "Question ID must be a valid UUID");
    }
    if (questionId) {
      const previousQuestionRow = seenQuestionIds.get(questionId);
      if (previousQuestionRow) {
        addError(row, "question_id", `Question ID duplicates row ${previousQuestionRow}`);
      } else {
        seenQuestionIds.set(questionId, row);
      }
    }
    if (questionId && !expectedVersionText) {
      addError(row, "expected_version", "Expected version is required when question_id is provided");
    } else if (!questionId && expectedVersionText) {
      addError(row, "question_id", "Question ID is required when expected_version is provided");
    } else if (expectedVersionText && (!/^[1-9]\d*$/.test(expectedVersionText) || !Number.isSafeInteger(Number(expectedVersionText)))) {
      addError(row, "expected_version", "Expected version must be an integer greater than or equal to 1");
    }
    const prompt = values.prompt.trim();
    const explanation = values.explanation.trim();
    if (!prompt) addError(row, "prompt", "Prompt is required");
    const normalized = normalizedPrompt(prompt);
    const previousRow = seenPrompts.get(normalized);
    if (prompt && previousRow) {
      addError(row, "prompt", `Prompt duplicates normalized prompt from row ${previousRow}`);
    } else if (prompt) {
      seenPrompts.set(normalized, row);
    }

    if (values.type !== "multiple_choice" && values.type !== "true_false") {
      addError(row, "type", "Type must be multiple_choice or true_false");
    }
    const pointsText = values.points.trim();
    if (!/^[1-9]\d*$/.test(pointsText) || !Number.isSafeInteger(Number(pointsText))) {
      addError(row, "points", "Points must be an integer greater than or equal to 1");
    }

    const choices: QuestionInput["choices"] = [];
    let correctCount = 0;
    for (let choiceIndex = 1; choiceIndex <= 4; choiceIndex += 1) {
      const label = values[`choice_${choiceIndex}` as keyof typeof values].trim();
      const correctness = values[`choice_${choiceIndex}_correct` as keyof typeof values].trim().toLowerCase();
      if (correctness && correctness !== "true" && correctness !== "false") {
        addError(row, `choice_${choiceIndex}_correct`, "Correctness must be true or false");
      }
      if (!label) {
        if (correctness === "true") {
          addError(row, `choice_${choiceIndex}_correct`, "A blank choice cannot be marked correct");
        }
        continue;
      }
      if (correctness !== "true" && correctness !== "false") continue;
      const isCorrect = correctness === "true";
      if (isCorrect) correctCount += 1;
      choices.push({ label, position: choices.length, isCorrect });
    }
    if (choices.length < 2 || choices.length > 4) {
      addError(row, "choice_1", "Each question must have 2 to 4 nonblank choices");
    }
    if (correctCount !== 1) {
      addError(row, "choice_1_correct", "Each question must have exactly one true correct flag");
    }

    const sourceTitle = values.source_title.trim();
    const sourceUrl = values.source_url.trim();
    if (sourceUrl) {
      try {
        new URL(sourceUrl);
      } catch {
        addError(row, "source_url", "Source URL must be a valid URL");
      }
      if (!sourceTitle) addError(row, "source_title", "Source title is required when source_url is provided");
    }

    const optionalTaxonomies: Array<["category_id" | "difficulty_id", string, "category" | "difficulty"]> = [
      ["category_id", values.category_id.trim(), "category"],
      ["difficulty_id", values.difficulty_id.trim(), "difficulty"],
    ];
    for (const [column, value, kind] of optionalTaxonomies) {
      if (!value) continue;
      if (!UUID_PATTERN.test(value)) addError(row, column, "Taxonomy ID must be a valid UUID");
      else taxonomyRefs.push({ row, column, id: value, kind });
    }
    const audienceIds = values.audience_ids.trim()
      ? values.audience_ids.split(";").map((value) => value.trim())
      : [];
    if (new Set(audienceIds).size !== audienceIds.length) {
      addError(row, "audience_ids", "Audience IDs must not be repeated");
    }
    for (const audienceId of audienceIds) {
      if (!UUID_PATTERN.test(audienceId)) addError(row, "audience_ids", "Each audience ID must be a valid UUID");
      else taxonomyRefs.push({ row, column: "audience_ids", id: audienceId, kind: "audience" });
    }

    if (
      prompt &&
      (values.type === "multiple_choice" || values.type === "true_false") &&
      /^[1-9]\d*$/.test(pointsText) &&
      Number.isSafeInteger(Number(pointsText)) &&
      choices.length >= 2 &&
      choices.length <= 4 &&
      correctCount === 1
    ) {
      inputs.push({
        row,
        ...(questionId && UUID_PATTERN.test(questionId) ? { questionId } : {}),
        ...(expectedVersionText && /^[1-9]\d*$/.test(expectedVersionText) && Number.isSafeInteger(Number(expectedVersionText))
          ? { expectedVersion: Number(expectedVersionText) }
          : {}),
        prompt,
        explanation,
        type: values.type,
        points: Number(pointsText),
        choices,
        sourceMetadata: sourceTitle
          ? [{ title: sourceTitle, ...(sourceUrl ? { url: sourceUrl } : {}) }]
          : [],
        categoryId: values.category_id.trim() || undefined,
        difficultyId: values.difficulty_id.trim() || undefined,
        audienceIds,
      });
    }
  });
  return { inputs, taxonomyRefs, rowErrors };
}