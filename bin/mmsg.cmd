@echo off
rem Minitor memory CLI wrapper - portable across clones.
rem %~dp0 resolves to this file's directory (with trailing backslash),
rem so the path below works regardless of where the repo was cloned.
node "%~dp0..\monitor\cli\mmsg.js" %*
