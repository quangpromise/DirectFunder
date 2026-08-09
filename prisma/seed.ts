import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { INITIAL_CASES, INITIAL_USERS } from "../src/lib/mock-data";
import { DEFAULT_COLUMNS, DEFAULT_FEATURE_PERMISSIONS } from "../src/lib/rbac";
import { hashPassword } from "../src/lib/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const user of INITIAL_USERS) {
    const passwordHash = await hashPassword(user.password ?? "");
    await prisma.user.upsert({
      where: { email: user.email.toLowerCase() },
      update: {},
      create: {
        id: user.id,
        name: user.name,
        email: user.email.toLowerCase(),
        passwordHash,
        role: user.role,
        avatarColor: user.avatarColor,
        avatarUrl: user.avatarUrl ?? null,
      },
    });
  }
  console.log(`Seeded ${INITIAL_USERS.length} user(s).`);

  for (const kase of INITIAL_CASES) {
    await prisma.case.upsert({
      where: { caseNumber: kase.caseNumber },
      update: {},
      create: {
        id: kase.id,
        status: kase.status,
        clients: kase.clients as unknown as Prisma.InputJsonValue,
        clientLink: kase.clientLink,
        zipcode: kase.zipcode,
        phone: kase.phone,
        address: kase.address,
        description: kase.description,
        descriptionReplies: kase.descriptionReplies as unknown as Prisma.InputJsonValue,
        descriptionReadBy: kase.descriptionReadBy,
        caseNumber: kase.caseNumber,
        money: kase.money,
        orders: kase.orders as unknown as Prisma.InputJsonValue,
        ssn: kase.ssn as unknown as Prisma.InputJsonValue,
        assignedTo: kase.assignedTo,
        assignedProcessor: kase.assignedProcessor,
        createdBy: kase.createdBy,
        custom: kase.custom as unknown as Prisma.InputJsonValue,
      },
    });
  }
  console.log(`Seeded ${INITIAL_CASES.length} case(s).`);

  await prisma.appConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      columns: DEFAULT_COLUMNS as unknown as Prisma.InputJsonValue,
      featurePermissions: DEFAULT_FEATURE_PERMISSIONS as unknown as Prisma.InputJsonValue,
    },
  });
  console.log("Seeded app config (columns + feature permissions).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
