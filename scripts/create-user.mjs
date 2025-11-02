import 'dotenv/config';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const [,, usernameArg, emailArg] = process.argv;
if (!usernameArg || !emailArg) {
  console.error('Usage: node scripts/create-user.mjs <username> <email>');
  process.exit(1);
}

const promptPassword = async () => {
  process.stdout.write('Password: ');
  return await new Promise((resolve) => {
    const stdin = process.stdin;
    const onData = (data) => {
      stdin.pause();
      stdin.removeListener('data', onData);
      resolve(String(data).trim());
    };
    stdin.resume();
    stdin.once('data', onData);
  });
};

const run = async () => {
  const password = await promptPassword();
  const hash = await bcrypt.hash(password, 10);
  const sql = postgres(url);
  try {
    await sql`
      insert into "t3-app-template_user" ("username", "email", "passwordHash")
      values (${usernameArg}, ${emailArg.toLowerCase()}, ${hash})
    `;
    console.log('Created user', usernameArg, emailArg);
  } catch (err) {
    console.error('Failed to create user:', err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
};

run();
