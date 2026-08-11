// Extracted from create-user (2026-08-11, staff-registration feature) so
// approve-staff-registration reuses the exact same role/scope shape
// instead of a copy that could drift out of sync over time.
//
//   general_manager  -> any role, any branch/region
//   regional_manager -> branch_manager / dispatcher / driver, only within
//                        their own region
//   branch_manager   -> dispatcher / driver, only within their own branch
//
// call_center and team_leader are deliberately reachable by
// general_manager ONLY - they're central roles not tied to a branch or
// region, so neither regional_manager nor branch_manager (whose whole
// authority is branch/region-scoped) can ever grant one. Not an
// oversight; the intended design.
import type { AppRole } from "./auth.ts";

export const BRANCH_SCOPED_ROLES: AppRole[] = ["driver", "dispatcher", "branch_manager"];
export const REGION_SCOPED_ROLES: AppRole[] = ["regional_manager"];
export const CENTRAL_ROLES: AppRole[] = ["general_manager", "team_leader", "call_center"];

export const ALL_STAFF_ROLES: AppRole[] = [
  ...BRANCH_SCOPED_ROLES,
  ...REGION_SCOPED_ROLES,
  ...CENTRAL_ROLES,
];
