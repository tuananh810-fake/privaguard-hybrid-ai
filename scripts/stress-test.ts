import {
  DEFAULT_CATEGORY_FILTER,
  redactLocally,
  rehydrateLocally,
  verifyZeroLeak,
} from '../src/services/piiVault.ts';

const CONCURRENT_USERS = 1000;

async function runStressTest() {
  const started = performance.now();

  const jobs = Array.from({ length: CONCURRENT_USERS }, (_, idx) =>
    Promise.resolve().then(() => {
      const name = `User Person ${idx}`;
      const email = `user${idx}.ops@enterprise${idx}.io`;
      const phone = `+84 912-${String(100 + (idx % 900))}-${String(100 + ((idx * 7) % 900))}`;
      const ip = `10.${idx % 255}.${(idx * 3) % 255}.${(idx * 11) % 255}`;
      const apiKey = `AIzaSyD9xK2mPqR8vL1nW4zT7cB0fH6jY3eU${String(idx).padStart(4, '0')}`;
      const raw = `Incident #${idx} reported by ${name} (${email}, ${phone}) on server ${ip}. Leaked key: ${apiKey}.`;

      const res = redactLocally(raw, [name], DEFAULT_CATEGORY_FILTER);
      const leakCount = verifyZeroLeak(res.redactedText, res.vault);
      if (leakCount > 0) {
        throw new Error(`LEAK DETECTED on user #${idx}: ${leakCount} leaks`);
      }
      if (res.vault.length < 5) {
        throw new Error(`UNDER-REDACTED on user #${idx}: expected >= 5, got ${res.vault.length}`);
      }

      const restored = rehydrateLocally(res.redactedText, res.vault);
      if (restored !== raw) {
        throw new Error(`REHYDRATION MISMATCH on user #${idx}`);
      }
      return res.vault.length;
    })
  );

  const counts = await Promise.all(jobs);
  const elapsedMs = Math.round(performance.now() - started);
  const totalSecrets = counts.reduce((a, b) => a + b, 0);

  console.log(
    `PASS: ${CONCURRENT_USERS} concurrent user documents shielded & re-hydrated in ${elapsedMs}ms (${(
      elapsedMs / CONCURRENT_USERS
    ).toFixed(3)}ms/doc) | ${totalSecrets} secrets protected | 0 leaks | 0 mismatches`
  );
}

runStressTest().catch((err) => {
  console.error('STRESS TEST FAILED:', err);
  process.exit(1);
});
