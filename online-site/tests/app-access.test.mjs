import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import test from "node:test";
import { verifyAppCredentials, authenticateAppUser } from "../lib/app-access.ts";

const password = "test-only-credential";
const salt = randomBytes(16);
const record = `pbkdf2-sha256$100000$${salt.toString("hex")}$${pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex")}`;
const credentials = { username: "TestOwner", passwordRecord: record };
const header = (user, pass) => "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

test("correct app login succeeds; old, incorrect and missing credentials fail", async () => {
  assert.equal(await verifyAppCredentials(header("TestOwner", password), credentials), true);
  assert.equal(await verifyAppCredentials(header("testowner", password), credentials), false);
  assert.equal(await verifyAppCredentials(header("TestOwner", "previous-password"), credentials), false);
  assert.equal(await verifyAppCredentials(null, credentials), false);
  for (const value of ["Basic !!!", "Basic /w==", "Bearer token", "Basic", "Basic " + Buffer.from("missing-colon").toString("base64")]) {
    assert.equal(await verifyAppCredentials(value, credentials), false);
  }
});

test("a changed password verifier invalidates the previous login", async () => {
  const changed = { ...credentials, passwordRecord: `pbkdf2-sha256$100000$${salt.toString("hex")}$${pbkdf2Sync("new-test-password", salt, 100000, 32, "sha256").toString("hex")}` };
  assert.equal(await verifyAppCredentials(header("TestOwner", password), changed), false);
  assert.equal(await verifyAppCredentials(header("TestOwner", "new-test-password"), changed), true);
});


test('server assigns roles from verified credentials and rejects cross-account passwords',async()=>{
 const generalRecord=`pbkdf2-sha256$100000$${salt.toString('hex')}$${pbkdf2Sync('staff-test-only',salt,100000,32,'sha256').toString('hex')}`;
 const env={APP_LOGIN_USERNAME:'TestOwner',APP_LOGIN_PASSWORD_RECORD:record,APP_GENERAL_USERNAME:'TestStaff',APP_GENERAL_PASSWORD_RECORD:generalRecord};
 assert.deepEqual(await authenticateAppUser(header('TestOwner',password),env),{username:'TestOwner',role:'admin'});
 assert.deepEqual(await authenticateAppUser(header('TestStaff','staff-test-only'),env),{username:'TestStaff',role:'general'});
 assert.equal(await authenticateAppUser(header('TestOwner','staff-test-only'),env),null);
 assert.equal(await authenticateAppUser(header('TestStaff',password),env),null);
 assert.equal(await authenticateAppUser(header('TestStaff:admin','staff-test-only'),env),null);
 assert.equal(await authenticateAppUser(null,env),null);
 assert.equal(await authenticateAppUser(header('TestStaff','staff-test-only'),{APP_LOGIN_USERNAME:'TestOwner',APP_LOGIN_PASSWORD_RECORD:record}),null);
});
