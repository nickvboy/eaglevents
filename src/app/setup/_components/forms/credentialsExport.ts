type GeneratedCredential = {
  scopeLabel: string;
  roleType: string;
  username: string;
  password: string;
  email: string;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  co_admin: "Co-admin",
  manager: "Manager",
  employee: "Employee",
};

export function formatGeneratedCredentials(users: GeneratedCredential[]) {
  return users
    .map((user) => {
      const roleLabel = ROLE_LABELS[user.roleType] ?? user.roleType;
      return [
        `Scope: ${user.scopeLabel}`,
        `Role: ${roleLabel}`,
        `Username: ${user.username}`,
        `Password: ${user.password}`,
        `Email: ${user.email}`,
      ].join("\n");
    })
    .join("\n\n");
}
