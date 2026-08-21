// Karim's request (2026-08-21): branch_manager and regional_manager are
// retired as roles - confirmed zero real accounts held either at the
// time of this change, so no existing staff needed migrating. Only
// general_manager creates staff accounts directly now (create-user);
// branch_manager/regional_manager's old create-user authority had no
// role left to hand it to, so it's gone rather than reassigned.
//
// The Postgres user_role enum still technically has these two values
// (Postgres can't drop an enum value in place) - they're just never
// reachable through any app code path anymore, not actively blocked at
// the DB level. Existing RLS policies that mention them are inert, not
// deleted: matching nobody is equivalent to not existing, and touching
// every policy file carried more risk than leaving them harmlessly unused.
import type { AppRole } from "./auth.ts";

export const BRANCH_SCOPED_ROLES: AppRole[] = ["driver", "dispatcher"];
export const CENTRAL_ROLES: AppRole[] = ["general_manager", "team_leader", "call_center"];

export const ALL_STAFF_ROLES: AppRole[] = [...BRANCH_SCOPED_ROLES, ...CENTRAL_ROLES];
