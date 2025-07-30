# Auth Worker Database Migration

This directory contains the authentication worker and database schema for the ukoly platform.

## Database Commands

### Migration Commands
```bash
# Run migration on remote database (production)
pnpm run migrate

# Run migration on local database (development)
pnpm run migrate:local

# Verify migration - show all tables
pnpm run db:verify

# Get database info
pnpm run db:info

# Open database console for manual queries
pnpm run db:console
```

### From Project Root
You can also run these commands from the project root:
```bash
# Run migration on remote database
pnpm run auth:migrate

# Verify migration
pnpm run auth:db:verify
```

## Database Schema

The current schema includes:
- **users table**: Stores user authentication data with username, password hash, and salt
- **Index on username**: For fast username lookups during login

## Migration Status

✅ **Migration Completed Successfully**
- Database: `ukoly-db` (b56fe79b-2c90-4aa9-a1c9-a59af5cdcb4a)
- Tables created: `users`
- Indexes created: `idx_users_username`

## Development Workflow

1. Make changes to `schema.sql`
2. Test locally: `pnpm run migrate:local`
3. Deploy to remote: `pnpm run migrate`
4. Verify: `pnpm run db:verify` 