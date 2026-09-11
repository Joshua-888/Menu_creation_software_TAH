# Security

- No secrets in git  
- `.env` gitignored; `.env.example` has placeholders only  
- Playwright auth state in `playwright/.auth/`  
- Never log passwords/cookies/tokens  
- Canary before customer production writes (M3+)  
- DRY_RUN must not mutate TakeAwayHero  
- Operator portal: `PORTAL_SESSION_SECRET`, bootstrap passwords, and session cookies stay in env / httpOnly cookies only — never commit  
- Portal MVP does not perform TakeAwayHero admin writes  
