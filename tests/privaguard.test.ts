import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CATEGORY_FILTER,
  redactLocally,
  rehydrateLocally,
  verifyZeroLeak,
} from '../src/services/piiVault.ts';
import {
  buildTaskPrompt,
  extractRiskBanner,
  parseStructuredAudit,
  structuredAuditToMarkdown,
} from '../src/services/hybridHelpers.ts';

test('redacts JWT, PEM private key, and DB connection URI with zero leaks', () => {
  const jwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const pem =
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234567890\n-----END RSA PRIVATE KEY-----';
  const dbUri = 'postgresql://admin:s3cr3tPass@db.internal.io:5432/prod';
  const raw = `Auth: ${jwt}\nDB: ${dbUri}\nKey:\n${pem}`;

  const res = redactLocally(raw);
  assert.equal(res.leaksFound, 0);
  assert.equal(res.vault.filter((v) => v.category === 'SECRET').length, 3);
  assert.equal(rehydrateLocally(res.redactedText, res.vault), raw);
});

test('redacts Vietnam 12-digit CCCD, VN phone, and US phone', () => {
  const raw = 'CCCD: 079200012345 | RawID 001098012345 | VN: +84 912-345-678 | Local: 0912-345-679 | US: (415) 890-2214';
  const res = redactLocally(raw);
  assert.equal(res.leaksFound, 0);
  assert.ok(res.vault.some((v) => v.category === 'ID' && v.original.includes('079200012345')));
  assert.ok(res.vault.some((v) => v.category === 'ID' && v.original === '001098012345'));
  assert.ok(res.vault.some((v) => v.category === 'PHONE' && v.original === '+84 912-345-678'));
  assert.ok(res.vault.some((v) => v.category === 'PHONE' && v.original === '0912-345-679'));
  assert.ok(res.vault.some((v) => v.category === 'PHONE' && v.original === '(415) 890-2214'));
  assert.equal(rehydrateLocally(res.redactedText, res.vault), raw);
});

test('Bug #1: PHONE regex does NOT falsely match invalid dotted-quad 999.999.999.999', () => {
  const raw = 'Invalid IP test: 999.999.999.999 should stay untouched.';
  const res = redactLocally(raw);
  assert.equal(res.vault.length, 0);
  assert.equal(res.redactedText, raw);
  assert.equal(res.leaksFound, 0);
});

test('Bug #2: IP regex ignores v1.2.3.4 and 1.2.3.4-rc1 and verifyZeroLeak avoids false leaks', () => {
  const raw = 'Release v1.2.3.4 and candidate 1.2.3.4-rc1 deployed to real node 1.2.3.4:8443 and 10.0.0.5.';
  const res = redactLocally(raw);
  assert.ok(res.redactedText.includes('v1.2.3.4'), 'v1.2.3.4 must not be redacted');
  assert.ok(res.redactedText.includes('1.2.3.4-rc1'), '1.2.3.4-rc1 must not be redacted');
  assert.equal(res.vault.filter((v) => v.category === 'IP').length, 2);
  assert.equal(res.leaksFound, 0, 'verifyZeroLeak must report 0 leaks even when v1.2.3.4 remains');
  assert.equal(verifyZeroLeak('Release v1.2.3.4 ok', [{ token: '[IP_1]', category: 'IP', original: '1.2.3.4' }]), 0);
  assert.equal(verifyZeroLeak('Leaked node 1.2.3.4 here', [{ token: '[IP_1]', category: 'IP', original: '1.2.3.4' }]), 1);
  assert.equal(rehydrateLocally(res.redactedText, res.vault), raw);
});

test('Bug #3: Custom terms match case-insensitively and preserve exact casing on re-hydration', () => {
  const raw = 'Owner Tuan Anh handed off to tuan anh and TUAN ANH.';
  const res = redactLocally(raw, ['Tuan Anh']);
  assert.equal(res.leaksFound, 0);
  assert.ok(!res.redactedText.toLowerCase().includes('tuan anh'));
  assert.equal(rehydrateLocally(res.redactedText, res.vault), raw);
});

test('Bug #4: Follow-up Q&A vault continuation prevents [EMAIL_1] token collision', () => {
  const docRes = redactLocally('Contact alice@acme.io for incident report.');
  assert.equal(docRes.vault[0].token, '[EMAIL_1]');
  assert.equal(docRes.vault[0].original, 'alice@acme.io');

  // Follow-up mentions BOTH existing email and a brand-new email
  const followUpRes = redactLocally(
    'Forward summary from alice@acme.io to bob@acme.io please.',
    [],
    DEFAULT_CATEGORY_FILTER,
    docRes.vault
  );
  assert.ok(followUpRes.redactedText.includes('[EMAIL_1]'), 'Existing email must reuse [EMAIL_1]');
  assert.ok(followUpRes.redactedText.includes('[EMAIL_2]'), 'New email must get [EMAIL_2], not collide');
  assert.equal(followUpRes.vault.length, 2);
  assert.equal(
    rehydrateLocally(followUpRes.redactedText, followUpRes.vault),
    'Forward summary from alice@acme.io to bob@acme.io please.'
  );
});

test('hybridHelpers: parseStructuredAudit, structuredAuditToMarkdown, extractRiskBanner, buildTaskPrompt', () => {
  const json = JSON.stringify({
    riskLevel: 'CRITICAL',
    riskScore: 92,
    summary: 'Exposed [SECRET_1] on [IP_1].',
    complianceFrameworks: ['SOC2', 'GDPR'],
    findings: [{ title: 'Hardcoded key', severity: 'CRITICAL', detail: '[SECRET_1] committed.' }],
    remediations: [{ step: 'Rotate [SECRET_1] immediately.', priority: 'IMMEDIATE' }],
  });

  const parsed = parseStructuredAudit('```json\n' + json + '\n```');
  assert.ok(parsed);
  assert.equal(parsed.riskLevel, 'CRITICAL');
  assert.equal(parsed.riskScore, 92);
  assert.deepEqual(parsed.complianceFrameworks, ['SOC2', 'GDPR']);

  const md = structuredAuditToMarkdown(parsed);
  assert.ok(md.includes('[SECRET_1]'));
  assert.ok(md.includes('SOC2, GDPR'));

  const banner = extractRiskBanner(md);
  assert.ok(banner);
  assert.equal(banner.level, 'CRITICAL');

  const prompt = buildTaskPrompt('Hello [PERSON_1]', 'risk_audit', true);
  assert.ok(prompt.includes('Hello [PERSON_1]'));
  assert.ok(prompt.includes('attached image'));

  assert.equal(parseStructuredAudit('not-valid-json'), null);
});
