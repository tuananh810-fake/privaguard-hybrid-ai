import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { redactLocally, type PiiCategory } from '../src/services/piiVault.ts';

interface ExpectedEntity {
  category: PiiCategory;
  value: string;
}

interface EvalSample {
  id: string;
  lang: 'en' | 'vi';
  text: string;
  expected: ExpectedEntity[];
}

interface CategoryStats {
  tp: number;
  fp: number;
  fn: number;
}

function normalize(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

function pct(val: number): string {
  return `${(val * 100).toFixed(1)}%`;
}

function calcMetrics(s: CategoryStats) {
  const precision = s.tp + s.fp === 0 ? 1 : s.tp / (s.tp + s.fp);
  const recall = s.tp + s.fn === 0 ? 1 : s.tp / (s.tp + s.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

async function main() {
  const fixturePath = path.resolve(process.cwd(), 'tests', 'fixtures', 'pii-eval.json');
  const raw = await readFile(fixturePath, 'utf-8');
  const samples = JSON.parse(raw) as EvalSample[];

  const categories: PiiCategory[] = ['EMAIL', 'PHONE', 'ID', 'CARD', 'SECRET', 'IP'];
  const stats = new Map<PiiCategory, CategoryStats>();
  for (const cat of categories) {
    stats.set(cat, { tp: 0, fp: 0, fn: 0 });
  }

  let decoyCount = 0;
  let decoyClean = 0;
  const failures: string[] = [];

  for (const sample of samples) {
    // Evaluate regex layer ONLY (no Nano, no manual terms)
    const result = redactLocally(sample.text, []);
    const predicted = result.vault.map((v) => ({
      category: v.category,
      value: normalize(v.original),
      matched: false,
    }));

    if (sample.expected.length === 0) {
      decoyCount += 1;
      if (predicted.length === 0) {
        decoyClean += 1;
      } else {
        failures.push(
          `[FP decoy ${sample.id}] falsely detected: ${predicted
            .map((p) => `${p.category}="${p.value}"`)
            .join(', ')}`
        );
      }
    }

    for (const exp of sample.expected) {
      const expNorm = normalize(exp.value);
      const hit = predicted.find(
        (p) =>
          !p.matched &&
          p.category === exp.category &&
          (p.value === expNorm || p.value.includes(expNorm) || expNorm.includes(p.value))
      );
      const bucket = stats.get(exp.category);
      if (hit) {
        hit.matched = true;
        if (bucket) bucket.tp += 1;
      } else {
        if (bucket) bucket.fn += 1;
        failures.push(`[FN ${sample.id}] missed ${exp.category}="${exp.value}"`);
      }
    }

    for (const pred of predicted) {
      if (!pred.matched) {
        const bucket = stats.get(pred.category);
        if (bucket) bucket.fp += 1;
        if (sample.expected.length > 0) {
          failures.push(`[FP ${sample.id}] extra ${pred.category}="${pred.value}"`);
        }
      }
    }
  }

  console.log(`\nPrivaGuard Regex PII Accuracy Eval (${samples.length} synthetic EN+VI samples, ${decoyCount} decoys)\n`);
  console.log('| Category | TP | FP | FN | Precision | Recall | F1 |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');

  const overall: CategoryStats = { tp: 0, fp: 0, fn: 0 };
  for (const cat of categories) {
    const s = stats.get(cat)!;
    overall.tp += s.tp;
    overall.fp += s.fp;
    overall.fn += s.fn;
    const m = calcMetrics(s);
    console.log(
      `| ${cat} | ${s.tp} | ${s.fp} | ${s.fn} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} |`
    );
  }

  const totalM = calcMetrics(overall);
  console.log(
    `| **OVERALL (Regex)** | **${overall.tp}** | **${overall.fp}** | **${overall.fn}** | **${pct(totalM.precision)}** | **${pct(totalM.recall)}** | **${pct(totalM.f1)}** |`
  );
  console.log(`\nDecoy rejection: ${decoyClean}/${decoyCount} clean (0 false positives on traps when ${decoyClean === decoyCount})`);
  console.log('Note: Free-form person names, private organizations, and street addresses depend on Gemini Nano on-device discovery and/or manual marks.');

  if (failures.length > 0) {
    console.log('\nDiscrepancies:');
    for (const f of failures) console.log(`  - ${f}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
