import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { membershipPlans, userMemberships, membershipGrants, membershipAuditLogs, type NewMembershipPlan, type NewUserMembership, type NewMembershipGrant, type NewMembershipAuditLog } from '../schema';

export const membershipPlanDao = {
  list() {
    return db.select().from(membershipPlans).orderBy(asc(membershipPlans.sortOrder), asc(membershipPlans.createdAt));
  },
  create(input: NewMembershipPlan) {
    return db.insert(membershipPlans).values(input).returning();
  },
};

export const userMembershipDao = {
  listByUserId(userId: string) {
    return db.select().from(userMemberships).where(eq(userMemberships.userId, userId)).orderBy(desc(userMemberships.createdAt));
  },
  create(input: NewUserMembership) {
    return db.insert(userMemberships).values(input).returning();
  },
};

export const membershipGrantDao = {
  create(input: NewMembershipGrant) {
    return db.insert(membershipGrants).values(input).returning();
  },
};

export const membershipAuditLogDao = {
  create(input: NewMembershipAuditLog) {
    return db.insert(membershipAuditLogs).values(input).returning();
  },
};
