import { Client } from "@elastic/elasticsearch";
import { eq, ilike, or } from "drizzle-orm";

import { env } from "~/env";
import { profiles, users } from "~/server/db/schema";

type DbClient = typeof import("~/server/db").db;

export type ProfileSearchResult = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  username: string | null;
};

type ProfileDocument = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  username?: string;
};

const elasticNode = env.ELASTICSEARCH_NODE;
const profileIndex = env.ELASTICSEARCH_PROFILE_INDEX ?? "profiles";

let elasticClient: Client | null | undefined;

function getClient() {
  if (elasticClient !== undefined) return elasticClient;
  if (!elasticNode) {
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
            fields: ["firstName^3", "lastName^3", "username^2", "email"],
          },
        },
      });
      const hits = response.hits.hits;
      if (hits?.length) {
        return hits
          .map((hit) => {
            const source = hit._source;
            if (!source) return null;
            return {
              id: source.id,
              firstName: source.firstName,
              lastName: source.lastName,
              email: source.email,
              username: source.username ?? null,
            } satisfies ProfileSearchResult;
          })
          .filter((entry): entry is ProfileSearchResult => Boolean(entry))
          .slice(0, limit);
      }
    } catch (error) {
      console.error("[profile-search] Elasticsearch search failed, falling back to DB:", error);
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
    })
    .from(profiles)
    .leftJoin(users, eq(users.id, profiles.userId))
    .where(
      or(
        ilike(profiles.firstName, likeTerm),
        ilike(profiles.lastName, likeTerm),
        ilike(profiles.email, likeTerm),
        ilike(users.username, likeTerm),
      ),
    )
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    username: row.username ?? null,
  }));
}

function escapeLike(input: string) {
  return input.replace(/[%_]/g, (match) => `\\${match}`);
}
