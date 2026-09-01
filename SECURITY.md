# Security Policy

## Supported version

Security fixes are made on the latest version of the `main` branch. Older deployments should update before reporting behavior that may already be fixed.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities, exposed credentials, authorization bypasses, or access to another workshop's data.

Use GitHub's **Security > Report a vulnerability** flow for this repository. If private vulnerability reporting is unavailable, contact the repository owner privately through their GitHub profile and include only enough information to establish a secure follow-up channel.

Include the affected version or commit, deployment type, reproduction steps, impact, and any suggested mitigation. Do not access participant data beyond what is necessary to demonstrate the issue.

## Deployment responsibilities

- Set a strong `FACILITATOR_PIN` and random `SESSION_SECRET` in production.
- Keep `.env`, database credentials, SSH keys, and saved game files out of Git.
- Use HTTPS for public deployments.
- Restrict SSH and database access to trusted networks or identities.
- Update Node.js, Docker images, and npm dependencies regularly.
- Treat room codes as workshop access credentials and rotate them between audiences when appropriate.
