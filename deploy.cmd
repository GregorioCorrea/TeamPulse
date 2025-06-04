@if "%SCM_TRACE_LEVEL%" NEQ "4" @echo off

:: 1. Install npm packages
call npm install

:: 2. Build TypeScript
call npm run build

:: 3. Copy package.json to output
copy package.json lib\

:: 4. Install production dependencies in lib
cd lib
call npm install --production
cd ..