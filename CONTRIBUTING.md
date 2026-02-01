# Contributing

Thanks for contributing!

## Development

Requirements:
- Node.js 20+ (22 recommended)

Install deps:

```bash
npm ci
```

Run checks:

```bash
npm run ci
```

## Project conventions

- Keep the plugin **safe by default**.
- Avoid adding any feature that enables arbitrary shell commands.
- Prefer small, reviewable commits.
- Add tests for any new safety checks (allowlists, bounds, schema validation).

## Security

If you believe you found a security issue, please follow `SECURITY.md`.
