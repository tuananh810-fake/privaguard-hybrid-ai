import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeWithContextGuard, type DocumentContextKind } from '../src/services/sensitivityEngine.ts';

interface ContextEvalCase {
  id: string;
  domain: string;
  lang: 'en' | 'vi';
  text: string;
  expectedContext: DocumentContextKind;
  mustMask: string[];
  mustKeep: string[];
}

async function main() {
  const fixturePath = path.resolve(process.cwd(), 'tests', 'fixtures', 'context-eval.json');
  const raw = await readFile(fixturePath, 'utf-8');
  const cases = JSON.parse(raw) as ContextEvalCase[];

  let contextCorrect = 0;
  let maskTotal = 0;
  let maskHit = 0;
  let keepTotal = 0;
  let keepHit = 0;
  let totalTimeMs = 0;
  const failures: string[] = [];

  for (const item of cases) {
    const res = analyzeWithContextGuard(item.text, { smartContextGuard: true });
    totalTimeMs += res.analysisTimeMs;

    if (res.contextKind === item.expectedContext) {
      contextCorrect += 1;
    } else {
      failures.push(
        `[CONTEXT ${item.id}] expected ${item.expectedContext}, got ${res.contextKind} (masked=${res.maskedByDefault.map((e) => e.original).join(', ')}; kept=${res.keptSafeByContext.map((e) => e.original).join(', ')})`
      );
    }

    const maskedOriginals = new Set(res.maskedByDefault.map((e) => e.original));
    const keptOriginals = new Set(res.keptSafeByContext.map((e) => e.original));

    for (const m of item.mustMask) {
      maskTotal += 1;
      const found =
        maskedOriginals.has(m) ||
        Array.from(maskedOriginals).some((v) => v.includes(m) || m.includes(v));
      if (found && !res.redactedText.includes(m)) {
        maskHit += 1;
      } else {
        failures.push(`[MISSED_SECRET ${item.id}] failed to mask "${m}"`);
      }
    }

    for (const k of item.mustKeep) {
      keepTotal += 1;
      const found =
        keptOriginals.has(k) ||
        Array.from(keptOriginals).some((v) => v.includes(k) || k.includes(v));
      if (found && res.redactedText.includes(k)) {
        keepHit += 1;
      } else {
        failures.push(`[OVER_MASKED ${item.id}] failed to keep benign "${k}" intact`);
      }
    }
  }

  // Also benchmark 1,000-doc throughput across mixed corpus
  const benchStart = performance.now();
  for (let i = 0; i < 1000; i++) {
    const sample = cases[i % cases.length];
    analyzeWithContextGuard(sample.text, { smartContextGuard: true });
  }
  const benchElapsed = performance.now() - benchStart;
  const avgMsPerDoc = benchElapsed / 1000;

  const ctxPct = (contextCorrect / cases.length) * 100;
  const maskPct = maskTotal === 0 ? 100 : (maskHit / maskTotal) * 100;
  const keepPct = keepTotal === 0 ? 100 : (keepHit / keepTotal) * 100;

  console.log(`\nPrivaGuard Context-Aware Sensitivity Eval (${cases.length} multi-domain EN+VI cases)\n`);
  console.log('| Metric | Result | Target |');
  console.log('|---|---:|---:|');
  console.log(`| Document Context Accuracy | ${contextCorrect}/${cases.length} (${ctxPct.toFixed(1)}%) | >= 95.0% |`);
  console.log(`| Real Secret / PII Recall | ${maskHit}/${maskTotal} (${maskPct.toFixed(1)}%) | 100.0% |`);
  console.log(`| Benign / Lab Preservation | ${keepHit}/${keepTotal} (${keepPct.toFixed(1)}%) | >= 95.0% |`);
  console.log(`| 1,000-Doc Throughput | ${benchElapsed.toFixed(1)} ms (${avgMsPerDoc.toFixed(3)} ms/doc) | < 1.500 ms/doc |`);
  console.log(`| Eval Corpus Total Time | ${totalTimeMs.toFixed(2)} ms | — |`);

  if (failures.length > 0) {
    console.log('\nDiscrepancies:');
    for (const f of failures) console.log(`  - ${f}`);
  }

  if (ctxPct < 95 || maskPct < 100 || keepPct < 95 || avgMsPerDoc >= 1.5) {
    console.error('\nContext eval quality gate FAILED.');
    process.exit(1);
  }
  console.log('\nContext eval quality gate PASSED.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
