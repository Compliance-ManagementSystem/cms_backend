// One-time: archive documents whose compliance record no longer exists.
// Dry run by default; pass --apply to write.
import 'dotenv/config';
import mongoose from 'mongoose';

const apply = process.argv.includes('--apply');
await mongoose.connect(process.env.MONGODB_URI, process.env.MONGODB_DB_NAME ? { dbName: process.env.MONGODB_DB_NAME } : {});
const db = mongoose.connection.db;
console.log('database:', db.databaseName);

const orphanPipeline = (extraMatch) => [
  { $match: { complianceRecord: { $ne: null }, ...extraMatch } },
  { $lookup: { from: 'compliancerecords', localField: 'complianceRecord', foreignField: '_id', as: 'rec' } },
  { $match: { rec: { $size: 0 } } },
  { $lookup: { from: 'locations', localField: 'location', foreignField: '_id', as: 'loc' } },
];

const docs = await db.collection('documents').aggregate(orphanPipeline({ status: { $ne: 'archived' } })).toArray();
console.log(`orphaned documents (not archived): ${docs.length}`);
for (const d of docs) console.log(` - ${d._id} "${d.name}" status=${d.status} location=${d.loc[0]?.name ?? '(none)'}`);

const tasks = await db.collection('tasks').aggregate(orphanPipeline({})).toArray();
console.log(`orphaned tasks (report only): ${tasks.length}`);
for (const t of tasks) console.log(` - ${t._id} "${t.title}" status=${t.status} location=${t.loc[0]?.name ?? '(none)'}`);

console.log('total compliance records:', await db.collection('compliancerecords').countDocuments());

if (apply && docs.length) {
  const res = await db.collection('documents').updateMany(
    { _id: { $in: docs.map((d) => d._id) } },
    { $set: { status: 'archived', updatedAt: new Date() } }
  );
  console.log(`archived: ${res.modifiedCount}`);
} else {
  console.log(apply ? 'nothing to archive' : 'dry run only, nothing changed');
}
await mongoose.disconnect();
