import { Client } from "@elastic/elasticsearch";
import { and, eq, ilike, inArray, or, isNull } from "drizzle-orm";

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
};

type ProfileDocument = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  username?: string;
  phoneNumber?: string | null;
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

export async function searchProfiles(query: string, limit: number, dbClient: DbClient) {
  const term = query.trim();
  if (!term) return [];

  const client = getClient();
  if (client) {
    try {
      const response = await client.search<ProfileDocument>({
        index: profileIndex,
        size: limit,
        query: {
          multi_match: {
            query: term,
            type: "bool_prefix",
            fields: ["firstName^3", "lastName^3", "username^2", "email", "phoneNumber"],
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
            } satisfies ProfileSearchResult;
          })
          .filter((entry): entry is ProfileSearchResult => Boolean(entry))
          .slice(0, limit);
        const resultIds = results.map((entry) => entry.id);
        if (resultIds.length === 0) return [];

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
        return results.filter((entry) => activeIdSet.has(entry.id));
      }
    } catch (error) {
      console.error("[profile-search] Elasticsearch search failed, falling back to DB:", error);
      // Disable the client for this process so subsequent calls go straight to the DB.
      elasticClient = null;
    }
  }

  return fallbackDbSearch(term, limit, dbClient);
}

async function fallbackDbSearch(term: string, limit: number, dbClient: DbClient) {
  const likeTerm = `%${escapeLike(term)}%`;
  const rows = await dbClient
    .select({
      id: profiles.id,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      email: profiles.email,
      username: users.username,
      phoneNumber: profiles.phoneNumber,
    })
    .from(profiles)
    .leftJoin(users, eq(users.id, profiles.userId))
    .where(
      and(
        or(eq(users.isActive, true), isNull(users.id)),
        or(
          ilike(profiles.firstName, likeTerm),
          ilike(profiles.lastName, likeTerm),
          ilike(profiles.email, likeTerm),
          ilike(profiles.phoneNumber, likeTerm),
          ilike(users.username, likeTerm),
        ),
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
  }));
}

function escapeLike(input: string) {
  return input.replace(/[%_]/g, (match) => `\\${match}`);
}

type IndexableProfile = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  username: string | null;
  phoneNumber: string | null;
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
      },
    });
  } catch (error) {
    console.error("[profile-search] Failed to index profile", error);
  }
}
