// `mailparser` ships no type declarations and no `@types/mailparser` matching
// the installed 3.9.x API is available. This ambient declaration only
// silences TS7016 ("could not find a declaration file"); it does not type
// the module. Call sites in parse.ts add their own narrow parameter types
// where TypeScript can't otherwise infer them from an `any`-typed value.
declare module 'mailparser';
