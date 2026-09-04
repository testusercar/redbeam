@echo off
setlocal
REM Native ARM64 release build.
REM
REM Two things this sets up that a bare `tauri build` does not:
REM
REM  1. RUSTUP_TOOLCHAIN. Aaron's machine is ARM64 hardware whose DEFAULT Rust
REM     toolchain is x86_64 (running under emulation), so a bare build produces
REM     an x64 binary. Setting it here rather than with `rustup default` leaves
REM     the global default alone — `tauri:build:x64` still works unchanged.
REM
REM  2. The MSVC ARM64 environment. `embed-resource` (the Windows icon
REM     resource, via tauri-winres) drives cc-rs, which needs cl.exe on PATH
REM     with INCLUDE and LIB set. Without vcvars it finds nothing and falls
REM     back to looking for clang, which is not installed.
REM
REM One-time setup: rustup toolchain install stable-aarch64-pc-windows-msvc

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo Could not find vswhere.exe. Visual Studio 2022 Build Tools are required.
  exit /b 1
)

for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -property installationPath`) do set "VSPATH=%%i"
if not defined VSPATH (
  echo Visual Studio 2022 Build Tools not found.
  exit /b 1
)

set "VCVARS=%VSPATH%\VC\Auxiliary\Build\vcvarsarm64.bat"
if not exist "%VCVARS%" (
  echo "%VCVARS%" is missing.
  echo Install the "MSVC v143 - VS 2022 C++ ARM64/ARM64EC build tools" component.
  exit /b 1
)

call "%VCVARS%"
if errorlevel 1 exit /b 1

set RUSTUP_TOOLCHAIN=stable-aarch64-pc-windows-msvc
call npx tauri build --target aarch64-pc-windows-msvc %*
exit /b %ERRORLEVEL%
