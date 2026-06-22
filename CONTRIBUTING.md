# Contributing to TenderWiseAI

Thanks for your interest in improving TenderWiseAI. This document covers the
basics for getting a change merged.

## Getting started

1. Fork the repository and clone your fork.
2. Install dependencies:

   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in credentials if you need to exercise
   the Azure Document Intelligence or Bedrock integrations. The local prototype
   works without any environment variables.
4. Start the app:

   ```bash
   npm start
   ```
5. Run the test suite before opening a pull request:

   ```bash
   npm test
   ```

## Making changes

- Create a branch off `main` for your change: `git checkout -b feature/short-description`.
- Keep pull requests focused on a single change; avoid bundling unrelated fixes.
- Add or update tests in `tests/` for any behavior change in `core.js`,
  `aiExtraction.js`, or `documentIntelligence.js`.
- Update `README.md` or `DEVELOPMENT.md` if you change setup steps, supported
  file formats, or environment variables.

## Commit messages

Use clear, descriptive commit messages that explain why a change was made, not
just what changed.

## Pull requests

- Describe what the PR does and why.
- Link any related issue (e.g. `Fixes #12`).
- Make sure CI (`.github/workflows/ci.yml`) passes before requesting review.

## Reporting bugs and requesting features

Please use the GitHub issue templates under **Issues > New issue** so reports
include the information maintainers need to triage them.

## Code of Conduct

This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.
