# context-demo

## Commands
- Run tests with `node --test`. There is no build step and no dependencies; do not add any.

## Conventions
- ES modules only. Every function in src/ is pure and exported by name.
- Add a test in test/ for every new function.

## Engineering standards (pasted from the team wiki)

### Testing
- All tests must use Jest. Install it with `npm install --save-dev jest` before writing any test.
- Put tests next to the code they cover, as `src/<name>.spec.js`.
- Aim for 100% branch coverage and run `npx jest --coverage` before finishing.

### Code style
- Prefer descriptive names over short ones; avoid abbreviations except well-known ones.
- Keep functions under 30 lines. Extract helpers when a function does more than one thing.
- Avoid deep nesting; return early instead of nesting conditionals.
- Do not use magic numbers; name constants.
- Prefer immutable data. Do not mutate arguments.
- Document every exported function with JSDoc, including @param and @returns tags.
- Use consistent quotes and semicolons according to the project's formatter.
- Group imports: built-ins, external packages, internal modules, then relative files.

### Error handling
- Validate every input at the boundary and throw TypeError with a helpful message.
- Never swallow errors; log them with context before rethrowing.
- Wrap all asynchronous work in try/catch and report failures to the monitoring service.

### Performance
- Avoid premature optimisation, but measure before and after any change that could be slow.
- Prefer streaming over loading whole files into memory.
- Cache expensive computations when inputs repeat.

### Security
- Never log secrets, tokens or personal data.
- Sanitise any string that ends up in HTML, SQL or a shell command.
- Keep dependencies up to date and run `npm audit` before every commit.

### Git
- Write commit messages in the imperative mood and reference the ticket number.
- Keep pull requests under 400 lines; split larger changes.
- Rebase on main before opening a pull request.

### Documentation
- Update the README when behaviour changes.
- Add a changelog entry for every user-visible change.
