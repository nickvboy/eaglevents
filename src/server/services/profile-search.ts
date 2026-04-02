import { Client } from "@elastic/elasticsearch";
import {
  and,
  eq,
  ilike,
  inArray,
  or,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";

import { env } from "~/env";
import { profiles, users } from "~/server/db/schema";
import type { db as dbClient } from "~/server/db";

type DbClient = typeof dbClient;

export type ProfileSearchResult = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  username: string | null;
  phoneNumber: string | null;
  affiliation: "staff" | "faculty" | "student" | null;
};

export type ProfileContactConflict = ProfileSearchResult & {
  matchesEmail: boolean;
  matchesPhoneNumber: boolean;
};

type ProfileDocument = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  username?: string;
  phoneNumber?: string | null;
  affiliation?: "staff" | "faculty" | "student" | null;
};

// Opt-in flag so local environments default to DB-backed search without ES timeouts.
const useElastic = env.ENABLE_ELASTICSEARCH === "true";
const elasticNode = env.ELASTICSEARCH_NODE;
const profileIndex = env.ELASTICSEARCH_PROFILE_INDEX ?? "profiles";

let elasticClient: Client | null | undefined;

function getClient() {
  if (!useElastic) {
    elasticClient = null;
    return elasticClient;
  }
  if (elasticClient !== undefined) return elasticClient;
  if (!elasticNode || elasticNode.trim().length === 0) {
    elasticClient = null;
    return elasticClient;
  }

  elasticClient = new Client({
    node: elasticNode,
    auth:
      env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD
        ? {
            username: env.ELASTICSEARCH_USERNAME,
            password: env.ELASTICSEARCH_PASSWORD,
          }
        : undefined,
  });
  return elasticClient;
}

export async function searchProfiles(
  query: string,
  limit: number,
  dbClient: DbClient,
) {
  const term = query.trim();
  if (!term) return [];

  const client = getClient();
  let elasticResults: ProfileSearchResult[] = [];
  if (client) {
    try {
      const response = await client.search<ProfileDocument>({
        index: profileIndex,
        size: limit,
        query: {
          multi_match: {
            query: term,
            type: "bool_prefix",
            fields: [
              "firstName^3",
              "lastName^3",
              "username^2",
              "email",
              "phoneNumber",
            ],
          },
        },
      });
      const hits = response.hits.hits;
      if (hits?.length) {
        const results = hits
          .map((hit) => {
            const source = hit._source;
            if (!source) return null;
            return {
              id: source.id,
              firstName: source.firstName,
              lastName: source.lastName,
              email: source.email,
              username: source.username ?? null,
              phoneNumber: source.phoneNumber ?? null,
              affiliation: source.affiliation ?? null,
            } satisfies ProfileSearchResult;
          })
          .filter((entry): entry is ProfileSearchResult => Boolean(entry))
          .slice(0, limit);
        const resultIds = results.map((entry) => entry.id);
        if (resultIds.length > 0) {
          const activeRows = await dbClient
            .select({ id: profiles.id })
            .from(profiles)
            .leftJoin(users, eq(users.id, profiles.userId))
            .where(
              and(
                inArray(profiles.id, resultIds),
                or(eq(users.isActive, true), isNull(users.id)),
              ),
            );
          const activeIdSet = new Set(activeRows.map((row) => row.id));
          elasticResults = results.filter((entry) => activeIdSet.has(entry.id));
        }
      }
    } catch (error) {
      console.error(
        "[profile-search] Elasticsearch search failed, falling back to DB:",
        error,
      );
      // Disable the client for this process so subsequent calls go straight to the DB.
      elasticClient = null;
    }
  }

  const dbResults = await fallbackDbSearch(term, limit, dbClient);
  if (elasticResults.length === 0) {
    return dbResults;
  }

  const merged = new Map<number, ProfileSearchResult>();
  for (const result of elasticResults) {
    merged.set(result.id, result);
  }
  for (const result of dbResults) {
    if (!merged.has(result.id)) {
      merged.set(result.id, result);
    }
  }
  return Array.from(merged.values()).slice(0, limit);
}

async function fallbackDbSearch(
  term: string,
  limit: number,
  dbClient: DbClient,
) {
  const normalizedTerm = term.trim();
  const nameLikeTerm = `%${escapeLike(normalizedTerm)}%`;
  const tokens = normalizedTerm
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 6);
  const tokenConditions = tokens.map((token) =>
    buildSearchTokenCondition(token),
  );
  const fullNameCondition = buildFullNameCondition(nameLikeTerm);
  const rows = await dbClient
    .select({
      id: profiles.id,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      email: profiles.email,
      username: users.username,
      phoneNumber: profiles.phoneNumber,
      affiliation: profiles.affiliation,
    })
    .from(profiles)
    .leftJoin(users, eq(users.id, profiles.userId))
    .where(
      and(
        or(eq(users.isActive, true), isNull(users.id)),
        fullNameCondition,
        ...tokenConditions,
      ),
    )
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    username: row.username ?? null,
    phoneNumber: row.phoneNumber ?? null,
    affiliation: row.affiliation ?? null,
  }));
}

function buildSearchTokenCondition(token: string): SQL<unknown> {
  const likeToken = `%${escapeLike(token)}%`;
  const phoneDigits = token.replace(/\D/g, "");
  const phoneCondition =
    phoneDigits.length > 0
      ? ilike(profiles.phoneNumber, `%${escapeLike(phoneDigits)}%`)
      : sql`false`;

  return (
    or(
      ilike(profiles.firstName, likeToken),
      ilike(profiles.lastName, likeToken),
      ilike(profiles.email, likeToken),
      ilike(users.username, likeToken),
      phoneCondition,
      sql`concat_ws(' ', ${profiles.firstName}, ${profiles.lastName}) ILIKE ${likeToken}`,
      sql`concat_ws(' ', ${profiles.lastName}, ${profiles.firstName}) ILIKE ${likeToken}`,
    ) ?? sql`false`
  );
}

function buildFullNameCondition(likeTerm: string): SQL<unknown> {
  const phoneDigits = likeTerm.replace(/[%_\\]/g, "").replace(/\D/g, "");
  const phoneCondition =
    phoneDigits.length > 0
      ? ilike(profiles.phoneNumber, `%${escapeLike(phoneDigits)}%`)
      : sql`false`;

  return (
    or(
      ilike(profiles.firstName, likeTerm),
      ilike(profiles.lastName, likeTerm),
      ilike(profiles.email, likeTerm),
      ilike(users.username, likeTerm),
      phoneCondition,
      sql`concat_ws(' ', ${profiles.firstName}, ${profiles.lastName}) ILIKE ${likeTerm}`,
      sql`concat_ws(' ', ${profiles.lastName}, ${profiles.firstName}) ILIKE ${likeTerm}`,
    ) ?? sql`false`
  );
}

function escapeLike(input: string) {
  return input.replace(/[%_]/g, (match) => `\\${match}`);
}

export async function findProfileContactConflicts(
  input: {
    email?: string | null;
    phoneNumber?: string | null;
    excludeProfileId?: number | null;
  },
  dbClient: DbClient,
) {
  const email = input.email?.trim().toLowerCase() ?? "";
  const phoneNumber = input.phoneNumber?.replace(/\D/g, "").slice(0, 32) ?? "";
  if (!email && !phoneNumber) return [];

  const conditions: SQL<unknown>[] = [];
  if (email) {
    conditions.push(eq(profiles.email, email));
  }
  if (phoneNumber) {
    conditions.push(eq(profiles.phoneNumber, phoneNumber));
  }

  const rows = await dbClient
    .select({
      id: profiles.id,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      email: profiles.email,
      username: users.username,
      phoneNumber: profiles.phoneNumber,
      affiliation: profiles.affiliation,
    })
    .from(profiles)
    .leftJoin(users, eq(users.id, profiles.userId))
    .where(
      and(
        input.excludeProfileId
          ? sql`${profiles.id} <> ${input.excludeProfileId}`
          : undefined,
        or(...conditions),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    username: row.username ?? null,
    phoneNumber: row.phoneNumber ?? null,
    affiliation: row.affiliation ?? null,
    matchesEmail: email.length > 0 && row.email.toLowerCase() === email,
    matchesPhoneNumber:
      phoneNumber.length > 0 && (row.phoneNumber ?? "") === phoneNumber,
  })) satisfies ProfileContactConflict[];
}

type IndexableProfile = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  username: string | null;
  phoneNumber: string | null;
  affiliation: "staff" | "faculty" | "student" | null;
};

export async function indexProfile(profile: IndexableProfile) {
  const client = getClient();
  if (!client) return;
  try {
    await client.index({
      index: profileIndex,
      id: String(profile.id),
      document: {
        id: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        username: profile.username ?? undefined,
        phoneNumber: profile.phoneNumber ?? undefined,
        affiliation: profile.affiliation ?? undefined,
      },
    });
  } catch (error) {
    console.error("[profile-search] Failed to index profile", error);
  }
}
