# Security Policy

## Supported Versions

This project is a single-version prototype; security fixes are applied to the
`main` branch only.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately rather
than opening a public issue:

1. Use GitHub's [private vulnerability reporting](https://github.com/Nandansai08/tender-ai-evaluator/security/advisories/new)
   for this repository, or
2. Contact the maintainer directly through their GitHub profile if private
   reporting is unavailable.

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce, including any sample tender/bidder files needed
- The affected file(s) or endpoint(s)

We aim to acknowledge reports within a few days. Please do not include real
credentials, API keys, or sensitive tender data in a report or reproduction
case.

## Scope

Known sensitive areas in this codebase:

- File upload and parsing (`server.js`, `documentIntelligence.js`) — input
  validation for `.pdf`, `.doc`, `.docx`, and image uploads.
- Credential handling for Azure Document Intelligence and Amazon Bedrock
  (`.env`, never committed; see `.env.example`).
