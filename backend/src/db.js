import { MongoClient, ObjectId } from "mongodb";
import { config } from "./config.js";

const client = new MongoClient(config.DATABASE_URL);
let database;
const collections = {
  user: "users",
  template: "templates",
  contact: "contacts",
  smtpAccount: "smtp_accounts",
  emailHistory: "email_history"
};

function collection(model) {
  if (!database) throw new Error("Database is not connected.");
  return database.collection(collections[model]);
}
function mongoId(id) {
  if (id instanceof ObjectId) return id;
  if (typeof id === "string" && ObjectId.isValid(id) && id.length === 24) return new ObjectId(id);
  return id;
}
function mapWhere(where = {}) {
  const out = {};
  for (const [key, value] of Object.entries(where)) {
    if (key === "OR") {
      out.$or = value.map(mapWhere);
    } else if (key === "AND") {
      out.$and = value.map(mapWhere);
    } else if (key === "id") {
      out._id = mongoId(value);
    } else if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof ObjectId)) {
      const ops = {};
      for (const [op, operand] of Object.entries(value)) {
        if (op === "contains") {
          const escaped = String(operand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          ops.$regex = escaped;
          if (value.mode === "insensitive") ops.$options = "i";
        } else if (op === "mode") {
          continue;
        } else if (op === "gte") ops.$gte = operand;
        else if (op === "gt") ops.$gt = operand;
        else if (op === "lte") ops.$lte = operand;
        else if (op === "lt") ops.$lt = operand;
        else if (op === "in") ops.$in = operand;
        else if (op === "not") ops.$ne = operand;
        else ops[op] = operand;
      }
      out[key] = ops;
    } else {
      out[key] = value;
    }
  }
  return out;
}
function plain(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return { id: String(_id), ...rest };
}
function project(doc, select) {
  const result = plain(doc);
  if (!select || !result) return result;
  return Object.fromEntries(Object.entries(select).filter(([, enabled]) => enabled).map(([key]) => [key, result[key]]));
}
function normalizeData(data = {}) {
  const out = { ...data };
  delete out.id;
  return out;
}
function modelApi(model) {
  const col = () => collection(model);
  return {
    async findUnique({ where, select } = {}) {
      const doc = await col().findOne(mapWhere(where));
      return project(doc, select);
    },
    async findFirst({ where, orderBy, select } = {}) {
      let cursor = col().find(mapWhere(where));
      if (orderBy) cursor = cursor.sort(Object.fromEntries(Object.entries(orderBy).map(([k,v]) => [k, v === "desc" ? -1 : 1])));
      return project(await cursor.limit(1).next(), select);
    },
    async findMany({ where, orderBy, take, select } = {}) {
      let cursor = col().find(mapWhere(where));
      if (orderBy) cursor = cursor.sort(Object.fromEntries(Object.entries(orderBy).map(([k,v]) => [k, v === "desc" ? -1 : 1])));
      if (Number.isInteger(take)) cursor = cursor.limit(take);
      const docs = await cursor.toArray();
      return docs.map(d => project(d, select));
    },
    async count({ where } = {}) {
      return col().countDocuments(mapWhere(where));
    },
    async create({ data, select } = {}) {
      const now = new Date();
      const doc = { ...normalizeData(data), createdAt: data.createdAt || now, updatedAt: data.updatedAt || now };
      if (model === "user") {
        const existing = await col().findOne({ email: doc.email });
        if (existing) {
          const error = new Error("Unique constraint failed on email");
          error.code = "P2002";
          throw error;
        }
      }
      const result = await col().insertOne(doc);
      return project({ ...doc, _id: result.insertedId }, select);
    },
    async update({ where, data, select } = {}) {
      const id = where?.id;
      const filter = mapWhere(where);
      const update = { ...normalizeData(data), updatedAt: new Date() };
      const result = await col().findOneAndUpdate(filter, { $set: update }, { returnDocument: "after" });
      const doc = result?.value ?? result;
      if (!doc) throw new Error(`${model} record not found`);
      return project(doc, select);
    },
    async updateMany({ where, data } = {}) {
      const update = { ...normalizeData(data), updatedAt: new Date() };
      const result = await col().updateMany(mapWhere(where), { $set: update });
      return { count: result.modifiedCount };
    },
    async deleteMany({ where } = {}) {
      const result = await col().deleteMany(mapWhere(where));
      return { count: result.deletedCount };
    },
    async delete({ where } = {}) {
      const doc = await col().findOne(mapWhere(where));
      if (!doc) throw new Error(`${model} record not found`);
      await col().deleteOne({ _id: doc._id });
      if (model === "smtpAccount") {
        await collection("emailHistory").updateMany({ smtpAccountId: String(doc._id) }, { $set: { smtpAccountId: null } });
      }
      return plain(doc);
    }
  };
}

export const prisma = {
  user: modelApi("user"),
  template: modelApi("template"),
  contact: modelApi("contact"),
  smtpAccount: modelApi("smtpAccount"),
  emailHistory: modelApi("emailHistory"),
  async $connect() {
    await client.connect();
    const url = new URL(config.DATABASE_URL);
    database = client.db(url.pathname.replace(/^\/+/, "").split("?")[0]);
    await database.collection("users").createIndex({ email: 1 }, { unique: true });
    await database.collection("templates").createIndex({ userId: 1, updatedAt: -1 });
    await database.collection("contacts").createIndex({ userId: 1, email: 1 });
    await database.collection("smtp_accounts").createIndex({ userId: 1 });
    await database.collection("email_history").createIndex({ userId: 1, createdAt: -1 });
  },
  async $disconnect() { await client.close(); }
};
