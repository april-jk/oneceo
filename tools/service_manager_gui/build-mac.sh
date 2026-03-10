#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL_DIR="${ROOT_DIR}/tools/service_manager_gui"
VENV_DIR="${TOOL_DIR}/.venv-build"
DIST_DIR="${TOOL_DIR}/dist"
BUILD_DIR="${TOOL_DIR}/build"
SPEC_FILE="${TOOL_DIR}/OneCEO Service Manager.spec"
PYTHON_BIN="${PYTHON_BIN:-python3}"
APP_NAME="OneCEO Service Manager"

"${PYTHON_BIN}" -m venv "${VENV_DIR}"
source "${VENV_DIR}/bin/activate"

python -m pip install --upgrade pip
python -m pip install "pyinstaller>=6.12,<7"

rm -rf "${DIST_DIR}" "${BUILD_DIR}" "${SPEC_FILE}"

pyinstaller \
  --noconfirm \
  --clean \
  --windowed \
  --name "${APP_NAME}" \
  --osx-bundle-identifier "ai.oneceo.service-manager" \
  --distpath "${DIST_DIR}" \
  --workpath "${BUILD_DIR}" \
  --specpath "${TOOL_DIR}" \
  "${TOOL_DIR}/service_manager_gui.py"

echo "[DONE] Build complete:"
echo "       ${DIST_DIR}/${APP_NAME}.app"
