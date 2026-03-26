#!/usr/bin/env node
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const isTestMode = process.env.CLAWSHIER_TEST_MODE === "1";
const openai = isTestMode ? null : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || "gpt-4o";

function getImagePath(argv = process.argv) {
  const imageArg = argv.indexOf("--image");
  if (imageArg === -1 || !argv[imageArg + 1]) {
    throw new Error("Usage: handler.js --image <path>");
  }
  return argv[imageArg + 1];
}

function runMockOcr(imagePath) {
  const fixturePath = process.env.CLAWSHIER_TEST_OCR_FIXTURE || path.resolve(__dirname, "../../test/fixtures/mock-ocr.txt");
  const base = path.basename(imagePath).toLowerCase();

  if (base.includes("not-a-receipt")) {
    throw new Error("Image does not appear to be a receipt or invoice");
  }

  return fs.readFileSync(fixturePath, "utf8").trim();
}

async function main() {
  const imagePath = getImagePath();

  if (isTestMode) {
    process.stdout.write(JSON.stringify({ ocr_text: runMockOcr(imagePath) }));
    return;
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString("base64");

  const ext = imagePath.split(".").pop().toLowerCase();
  const mimeTypes = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
  const mime = mimeTypes[ext] || "image/jpeg";

  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract ALL visible text from this receipt or invoice image. Reproduce the text exactly as it appears, preserving line breaks. If this is not a receipt or invoice, respond with exactly: NOT_A_RECEIPT",
          },
          {
            type: "image_url",
            image_url: { url: `data:${mime};base64,${base64}` },
          },
        ],
      },
    ],
    max_tokens: 2048,
  });

  const ocrText = response.choices[0].message.content.trim();

  if (ocrText === "NOT_A_RECEIPT") {
    throw new Error("Image does not appear to be a receipt or invoice");
  }

  process.stdout.write(JSON.stringify({ ocr_text: ocrText }));
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ error: err.message }));
  process.exit(1);
});
