/**
 * The Vercel Function behind every /api/* route. vercel.json rewrites
 * /api/<path> to /api?route=<path>; the shared router (src/web/api.ts) takes
 * it from there. The pages themselves are static files built by `bun run build`.
 */
import { handleApi } from '../src/web/api.js';

export const GET = handleApi;
export const POST = handleApi;
