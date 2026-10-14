// Vercel's entry point for the API. vercel.json rewrites every /api/* path
// here; the request keeps its original URL, so Hono routes it as usual. It
// imports the compiled server, which `npm run build` writes before Vercel
// bundles this function.
import { createVercelApp } from '../dist/server/vercel.js';

const app = createVercelApp();

/** @param {Request} request */
const handler = (request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
