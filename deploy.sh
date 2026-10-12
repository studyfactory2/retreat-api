#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: bash deploy.sh COMMAND

Run from your EC2 checkout as its owner. Each command is a separate step:
  pull      Fast-forward the clean master checkout from origin/master
  prepare   Validate .env and build API/operator images for this Git commit
  db        Start PostgreSQL and wait; preserve an existing DB container
  migrate   Apply committed migrations, then show migration status
  admin     Interactively create the first administrator
  up        Check migration status, then start/update only the API
  status    Show container status
  logs      Show the last 100 API/database log lines
  help      Show this help without accessing Docker or configuration

Prepare never starts services. Only migrate applies migrations; admin is manual.
Before migrating an existing production database, take and verify a backup.
HELP
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_clean_checkout() {
  [[ "$(git branch --show-current)" == master ]] ||
    fail 'Switch to master before preparing or deploying a release.'
  [[ -z "$(git status --porcelain --untracked-files=normal)" ]] ||
    fail 'Commit or move local changes first. This script never resets or stashes files.'
}

# Docker may need sudo, but Git must always run as the checkout owner.
docker_access() {
  if [[ "$use_sudo" == true ]]; then
    sudo "$@"
  else
    "$@"
  fi
}

compose() {
  # Compose parses .env as data. Never source it as shell code. Clear inherited
  # application variables so the server file wins; set the tag AFTER sudo.
  docker_access env -u POSTGRES_PASSWORD -u JWT_SECRET -u FRONTEND_URL \
    -u AWS_REGION -u S3_BUCKET_NAME -u TRUST_PROXY -u COMPOSE_PROFILES \
    RELEASE_TAG="$release_tag" docker compose \
    --project-name retreat-api --env-file "$repo_dir/.env" \
    --file "$repo_dir/compose.production.yml" "$@"
}

require_image() {
  docker_access docker image inspect "$1:$release_tag" >/dev/null 2>&1 ||
    fail "Missing $1 image for this commit. Run bash deploy.sh prepare first."
}

require_database() {
  local container_id health
  container_id="$(compose ps --all --quiet db)"
  [[ -n "$container_id" ]] || fail 'Start PostgreSQL with bash deploy.sh db first.'
  health="$(docker_access docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id")"
  [[ "$health" == healthy ]] || fail 'PostgreSQL is not healthy. Check bash deploy.sh status and logs.'
}

operator() {
  compose run --rm --no-deps --pull never operator "$@"
}

main() {
  [[ $# -le 1 ]] || fail 'Pass exactly one command. Run bash deploy.sh help.'
  local action="${1:-help}"
  case "$action" in
    help|-h|--help) usage; return ;;
    pull|prepare|db|migrate|admin|up|status|logs) ;;
    *) fail "Unknown command: $action. Run bash deploy.sh help." ;;
  esac

  [[ $EUID -ne 0 ]] || fail 'Run bash deploy.sh as the checkout owner, without sudo. Docker sudo is handled internally.'
  repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  cd -- "$repo_dir"
  command -v git >/dev/null || fail 'Git is required.'
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail 'Run from a Git checkout.'

  case "$action" in
    pull|prepare|migrate|admin|up) require_clean_checkout ;;
  esac
  if [[ "$action" == pull ]]; then
    # Replace this process: a pull may update deploy.sh itself. The next command
    # starts a new shell reading the newly pulled script.
    exec git pull --ff-only origin master
  fi

  [[ -f .env ]] || fail 'Create the server .env first; see docs/backend-containers.md.'
  [[ -f compose.production.yml ]] || fail 'compose.production.yml is missing.'
  release_tag="$(git rev-parse --verify HEAD)"
  export RELEASE_TAG="$release_tag"
  command -v docker >/dev/null || fail 'Install Docker and the Compose plugin first.'
  use_sudo=false
  if ! docker info >/dev/null 2>&1; then
    command -v sudo >/dev/null || fail 'Docker is unavailable and sudo is not installed.'
    use_sudo=true
    sudo docker info >/dev/null || fail 'Cannot access the Docker daemon.'
  fi
  docker_access docker compose version >/dev/null
  compose config --quiet

  case "$action" in
    prepare)
      printf 'Building backend release %s; services will not start.\n' "$release_tag"
      compose --parallel 1 build api operator
      ;;
    db)
      compose up -d --no-recreate --wait --wait-timeout 120 db
      ;;
    migrate)
      require_image retreat-api-operator
      require_database
      operator node node_modules/prisma/build/index.js migrate deploy
      operator node node_modules/prisma/build/index.js migrate status
      ;;
    admin)
      [[ -t 0 && -t 1 ]] || fail 'Admin creation needs an interactive terminal.'
      require_image retreat-api-operator
      require_database
      operator npm run admin:create
      ;;
    up)
      require_image retreat-api
      require_image retreat-api-operator
      require_database
      operator node node_modules/prisma/build/index.js migrate status
      compose up -d --no-deps --no-build --pull never --wait --wait-timeout 120 api
      printf 'API health check passed. Public HTTPS and application acceptance are separate steps.\n'
      ;;
    status) compose ps --all ;;
    logs) compose logs --tail=100 api db ;;
  esac
}

# Keep execution after all function definitions, including when pull updates this file.
main "$@"
