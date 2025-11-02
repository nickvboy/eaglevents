"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

export function LatestPost() {
  const [latestPost] = api.post.getLatest.useSuspenseQuery();

  const utils = api.useUtils();
  const [name, setName] = useState("");
  const createPost = api.post.create.useMutation({
    onSuccess: async () => {
      await utils.post.invalidate();
      setName("");
    },
  });

  return (
    <div className="w-full max-w-md rounded-xl bg-white/10 p-4">
      <h2 className="mb-2 text-xl font-semibold">Create Post</h2>
      <p className="mb-3 text-sm text-white/80">
        {latestPost ? (
          <>Your most recent post: <span className="font-medium">{latestPost.name}</span></>
        ) : (
          <>You have no posts yet.</>
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createPost.mutate({ name });
        }}
        className="flex flex-col gap-2"
      >
        <input
          type="text"
          placeholder="Title"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-full bg-white/10 px-4 py-2 text-white placeholder:text-white/60"
        />
        <button
          type="submit"
          className="rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20"
          disabled={createPost.isPending}
        >
          {createPost.isPending ? "Submitting..." : "Submit"}
        </button>
      </form>
    </div>
  );
}

export function AllPosts() {
  const [posts] = api.post.getAll.useSuspenseQuery();

  return (
    <div className="w-full max-w-md rounded-xl bg-white/10 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">All Posts</h2>
        <span className="text-xs text-white/60">{posts?.length ?? 0} total</span>
      </div>
      {(!posts || posts.length === 0) ? (
        <p className="text-sm text-white/80">No posts yet.</p>
      ) : (
        <ul className="space-y-2">
          {posts.map((p) => {
            const created = p?.createdAt ? new Date(p.createdAt as unknown as string) : undefined;
            const when = created ? created.toLocaleString() : "";
            return (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2"
              >
                <span className="truncate pr-3 font-medium">{p.name}</span>
                <span className="shrink-0 text-xs text-white/60">{when}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
