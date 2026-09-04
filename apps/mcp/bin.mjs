#!/usr/bin/env node
/**
 * Entry point for the REDBEAM MCP server.
 *
 * Deliberately separate from index.mjs so there is no "am I the main module?"
 * check to get wrong: running this file starts the server, importing
 * index.mjs does not. The first version of this guessed by comparing
 * import.meta.url to argv[1], which fails on a Windows path with spaces and
 * left a server that started, printed nothing and exited.
 */
import { startServer } from './index.mjs'
startServer()
