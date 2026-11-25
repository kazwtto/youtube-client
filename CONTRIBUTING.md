# Contributing to YouTube Client

Thanks for your interest in contributing!

## Local Setup

1. Install [Rust](https://rustup.rs/) (1.77+), [Node.js](https://nodejs.org/) (20+), and the Visual Studio C++ Build Tools on Windows 10/11.
2. Install dependencies:
   ```powershell
   npm install
   ```
3. Run the app in development mode:
   ```powershell
   npm run tauri:dev
   ```

## Guidelines

- Keep frontend changes in `src/` typed with TypeScript and accessible via keyboard.
- Register every new Tauri command in `src-tauri/src/lib.rs`, `src-tauri/build.rs`, and the appropriate capability file in `src-tauri/capabilities/`.
- Update both `src/i18n/locales/en.ts` and `src/i18n/locales/pt-BR.ts` when adding user-facing strings.
- Open a clear pull request describing what changed and why.
