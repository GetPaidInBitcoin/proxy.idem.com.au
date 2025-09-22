#!/bin/bash

# Idem Proxy Deployment Script
# Usage: ./deploy.sh [git-tree-ish]
# Default git-tree-ish is "main"
#
# Examples:
#   ./deploy.sh                    # Deploy main branch
#   ./deploy.sh development        # Deploy development branch
#   ./deploy.sh faa0e9e08ec4       # Deploy specific commit

set -e  # Exit on any error

# Configuration
GIT_TARGET="${1:-main}"
APP_NAME="id"
SERVICE_DIR="~/proxy.idem.com.au"
BACKUP_BRANCH="deploy-backup-$(date +%Y%m%d-%H%M%S)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if PM2 is running
check_pm2_status() {
    if ! command -v pm2 &> /dev/null; then
        log_error "PM2 is not installed"
        exit 1
    fi
    
    # Check if PM2 daemon is running
    if ! pm2 ping &> /dev/null; then
        log_warning "PM2 daemon is not running. Starting PM2..."
        pm2 ping
    fi
}

# Function to check if app exists in PM2
check_app_exists() {
    if pm2 describe "$APP_NAME" &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# Function to stop services safely
stop_services() {
    log_info "Stopping services..."
    
    # Stop nginx
    if sudo systemctl is-active --quiet nginx; then
        log_info "Stopping nginx..."
        sudo systemctl stop nginx
    else
        log_warning "Nginx is not running"
    fi
    
    # Stop PM2 app if it exists
    if check_app_exists; then
        log_info "Stopping PM2 app: $APP_NAME"
        pm2 stop "$APP_NAME"
    else
        log_warning "PM2 app '$APP_NAME' not found"
    fi
}

# Function to start services
start_services() {
    log_info "Starting services..."
    
    # Start or restart PM2 app
    if check_app_exists; then
        log_info "Restarting PM2 app: $APP_NAME"
        pm2 restart "$APP_NAME"
    else
        log_info "Starting new PM2 app: $APP_NAME"
        pm2 start "$APP_NAME"
    fi
    
    # Start nginx
    log_info "Starting nginx..."
    sudo systemctl start nginx
    
    # Verify services are running
    sleep 2
    if sudo systemctl is-active --quiet nginx; then
        log_success "Nginx is running"
    else
        log_error "Failed to start nginx"
        exit 1
    fi
    
    if pm2 describe "$APP_NAME" | grep -q "online"; then
        log_success "PM2 app '$APP_NAME' is running"
    else
        log_error "Failed to start PM2 app '$APP_NAME'"
        exit 1
    fi
}

# Function to deploy application
deploy_app() {
    log_info "Deploying to target: $GIT_TARGET"

    # Check pwd is SERVICE_DIR
    if [ "$(pwd)" != "$SERVICE_DIR" ]; then
        log_info "Changing to service directory: $SERVICE_DIR"
        cd "$SERVICE_DIR" || {
            log_error "Failed to change to directory: $SERVICE_DIR"
            exit 1
        }
    fi
    
    # Get current branch for backup
    CURRENT_BRANCH=$(git branch --show-current)
    log_info "Current branch: $CURRENT_BRANCH"
    
    # Create backup branch
    log_info "Creating backup branch: $BACKUP_BRANCH"
    git branch "$BACKUP_BRANCH"
    
    # Stash any uncommitted changes
    if ! git diff --quiet || ! git diff --cached --quiet; then
        log_info "Stashing uncommitted changes..."
        git stash push -m "Deploy stash $(date)"
    else
        log_info "No uncommitted changes to stash"
    fi
    
    # Checkout target branch/commit
    log_info "Checking out: $GIT_TARGET"
    git checkout "$GIT_TARGET"
    
    # Pull latest changes if it's a branch
    if git show-ref --verify --quiet "refs/heads/$GIT_TARGET"; then
        log_info "Pulling latest changes from origin/$GIT_TARGET"
        git pull origin "$GIT_TARGET"
    else
        log_info "$GIT_TARGET appears to be a commit hash or tag"
    fi
    
    # Clean build directory
    if [ -d "dist" ]; then
        log_info "Removing old build directory"
        rm -rf dist
    fi
    
    # Install dependencies and build
    log_info "Installing dependencies..."
    yarn install --frozen-lockfile
    
    log_info "Building application..."
    yarn build
}

# Function to rollback on failure
rollback() {
    log_error "Deployment failed. Attempting rollback..."
    
    # Go back to backup branch
    git checkout "$BACKUP_BRANCH"
    
    # Restore stashed changes if any
    if git stash list | grep -q "Deploy stash"; then
        log_info "Restoring stashed changes..."
        git stash pop
    fi
    
    # Start services anyway
    start_services
    
    log_error "Rollback completed. Please check the application status."
    exit 1
}

# Main deployment process
main() {
    log_info "=== Starting Idem Proxy Deployment ==="
    log_info "Target: $GIT_TARGET"
    log_info "Timestamp: $(date)"
    
    # Check PM2 status
    check_pm2_status
    
    # Set up error handling
    trap rollback ERR
    
    # Stop services
    stop_services
    
    # Deploy application
    deploy_app
    
    # Start services
    start_services
    
    # Cleanup old backup branches (keep last 5)
    log_info "Cleaning up old backup branches..."
    git for-each-ref --format='%(refname:short) %(committerdate)' refs/heads/deploy-backup-* \
        | sort -k2 -r | tail -n +6 | awk '{print $1}' \
        | xargs -r git branch -D
    
    log_success "=== Deployment completed successfully ==="
    log_info "Application is running at the deployed version"
    log_info "Backup branch created: $BACKUP_BRANCH"
}

# Run main function
main "$@"
