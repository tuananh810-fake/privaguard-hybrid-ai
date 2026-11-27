export interface SampleDoc {
  id: string;
  label: string;
  badge: string;
  content: string;
}

export const SAMPLE_DOCUMENTS: SampleDoc[] = [
  {
    id: 'devops',
    label: 'DevOps Incident Log',
    badge: 'API Keys & IPs',
    content: `URGENT INCIDENT #4821 — Production Auth Outage
Reported by: Nguyen Tuan Anh (tuananh.ops@acmecorp.io, +84 912-345-678)
Affected node: 192.168.42.19:8443 -> upstream 34.117.59.81
Root cause: Developer accidentally pushed production key AIzaSyD9xK2mPqR8vL1nW4zT7cB0fH6jY3eU5aQ and GitHub token ghp_9xK2mPqR8vL1nW4zT7cB0fH6jY3eU5aQ8891 into staging config.
Impact: 14% failed logins for 18 minutes. Need immediate key rotation, firewall lock on 34.117.59.81, and post-mortem draft before 5 PM.`,
  },
  {
    id: 'medical',
    label: 'Clinical Patient Note',
    badge: 'HIPAA / PII',
    content: `Patient Intake Summary — MRN-8849201
Patient: Sarah Jenkins | SSN: 412-88-9034 | Phone: (415) 890-2214 | Email: sarah.jenkins@gmail.com
Symptoms: Persistent migraine for 5 days, mild photophobia, elevated blood pressure (142/92).
Current Rx: Sumatriptan 50mg PRN. Allergy: Penicillin.
Plan: Order non-contrast MRI, follow-up neurology consult in 7 days, instruct patient to monitor BP twice daily and visit ER if vision blurs.`,
  },
  {
    id: 'contract',
    label: 'Freelance NDA & Payout',
    badge: 'Banking & Legal',
    content: `Independent Contractor Addendum
Client: David Chen (david.chen@northstarlabs.co, +1 650-442-9910)
Contractor Payment Details: Card 4532-8910-4421-7782 / IBAN DE89370400440532013000
Scope: Deliver Hybrid AI web prototype by Dec 1, 2026 for $6,500 USD (50% upfront, 50% on acceptance).
Clause 4.2: Unlimited liability for any third-party API downtime and automatic 5-year global non-compete across all software industries.
Question: Are there unfair legal traps here I should renegotiate before signing?`,
  },
];
