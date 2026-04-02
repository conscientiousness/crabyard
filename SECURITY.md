# Security Policy

## Supported Versions

Security fixes are applied to the latest code on `main` and the latest published release.

## Reporting a Vulnerability

Please do not open a public issue for an undisclosed vulnerability.

Prefer private reporting through GitHub's security reporting flow when it is enabled for the repository.

If private reporting is not available yet, contact the maintainers privately before public disclosure and include:

- a clear description of the issue
- reproduction steps or a proof of concept
- impact assessment
- any suggested mitigation

## Scope Notes

This repository ships a CLI and repo-installed workflow assets.

- the CLI reads and writes files in the target repository
- the installed workflow content is documentation and skill metadata, not a network service
- overall risk still depends on how the CLI is used in automation and what repositories it is pointed at
