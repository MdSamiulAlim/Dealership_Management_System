declare namespace Cloudflare {
  interface Env {
    BACKUPS?: R2Bucket;
    SITES_OPERATIONS_OWNER_EMAIL?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
    APP_LOGIN_USERNAME?: string;
    APP_LOGIN_PASSWORD_RECORD?: string;
    APP_GENERAL_USERNAME?: string;
    APP_GENERAL_PASSWORD_RECORD?: string;
  }
}
