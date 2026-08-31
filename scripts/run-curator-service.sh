#!/usr/bin/env bash
set -euo pipefail

: "${UNABOT_BUN_BIN:?UNABOT_BUN_BIN is required}"
: "${UNABOT_CURATOR_STATE_DIR:?UNABOT_CURATOR_STATE_DIR is required}"

repository="$(pwd -P)"
state_dir="${UNABOT_CURATOR_STATE_DIR}"
worktree="${state_dir}/catalog-worktree"
mkdir -p "${state_dir}"
chmod 700 "${state_dir}"

exec 9>"${state_dir}/run.lock"
if ! flock -n 9; then
  printf '%s\n' '{"status":"skipped","reason":"curator run already active"}'
  exit 0
fi

git fetch --quiet origin main
base_commit="$(git rev-parse origin/main)"
if git worktree list --porcelain | grep -Fxq "worktree ${worktree}"; then
  git worktree remove --force "${worktree}"
fi
git worktree prune
git worktree add --quiet --detach "${worktree}" "${base_commit}"

cleanup() {
  cd "${repository}"
  git worktree remove --force "${worktree}" >/dev/null 2>&1 || true
  git worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "${worktree}"
"${UNABOT_BUN_BIN}" install --frozen-lockfile >"${state_dir}/install.log" 2>&1
"${UNABOT_BUN_BIN}" src/curator/vault-cli.ts --apply >"${state_dir}/vault-collector.log" 2>&1

mapfile -t changed < <(git diff --name-only)
if [[ ${#changed[@]} -eq 0 ]]; then
  printf '{"status":"complete","base":"%s","action":"no-change"}\n' "${base_commit}"
  exit 0
fi
for path in "${changed[@]}"; do
  case "${path}" in
    src/config/stable-vaults.json) ;;
    *) printf 'Unexpected curator change: %s\n' "${path}" >&2; exit 1 ;;
  esac
done

{
  "${UNABOT_BUN_BIN}" test
  "${UNABOT_BUN_BIN}" run typecheck
  "${UNABOT_BUN_BIN}" run build:web
} >"${state_dir}/validation.log" 2>&1

mapfile -t validated_changed < <(git diff --name-only)
for path in "${validated_changed[@]}"; do
  case "${path}" in
    src/config/stable-vaults.json|vendor/hosted-cjs/index.cjs) ;;
    *) printf 'Unexpected post-validation change: %s\n' "${path}" >&2; exit 1 ;;
  esac
done

git add -- src/config/stable-vaults.json
if git diff --cached --quiet; then
  printf '{"status":"complete","base":"%s","action":"no-change"}\n' "${base_commit}"
  exit 0
fi
git -c user.name="Wizzy Curator" -c user.email="curator@wizzy.meme" commit --quiet -m "curator: apply stable vault decision"
current_remote="$(git ls-remote origin refs/heads/main | cut -f1)"
if [[ "${current_remote}" != "${base_commit}" ]]; then
  printf 'Main advanced from %s to %s during curator validation; refusing stale push\n' "${base_commit}" "${current_remote}" >&2
  exit 1
fi
git push --quiet origin HEAD:main
published_commit="$(git rev-parse HEAD)"
printf '{"status":"complete","base":"%s","action":"published","commit":"%s"}\n' "${base_commit}" "${published_commit}"
