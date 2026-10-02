// Seeds the database from the scraper's stage-2 output
// (data/faculty_details.json). Falls back to a few realistic sample faculty
// if that file doesn't exist, so the stack is testable before scraping is done.
//
// Upserts on profileUrl (the natural unique key — emails have a few dupes in
// the real data, URLs are 1:1), so re-running the seed is idempotent.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DETAILS_PATH = join(__dirname, "..", "..", "data", "faculty_details.json");

const SAMPLE_FACULTY = [
  {
    name: "Tian Lan",
    school: "School of Engineering and Applied Science",
    department: "Electrical and Computer Engineering",
    title: "Professor of Electrical and Computer Engineering",
    email: "tlan@gwu.edu",
    bio: "Research in machine learning, networked systems, and optimization.",
    profile_url: "https://example.gwu.edu/tian.lan",
    image_url: null,
    research_interests: ["Machine learning", "Networked systems", "Optimization"],
  },
  {
    name: "Robert Pless",
    school: "School of Engineering and Applied Science",
    department: "Computer Science",
    title: "Professor and Chair of Computer Science",
    email: "pless@gwu.edu",
    bio: "Computer vision, machine learning, and data science.",
    profile_url: "https://example.gwu.edu/robert.pless",
    image_url: null,
    research_interests: ["Computer vision", "Machine learning", "Data science"],
  },
  {
    name: "Poorvi Vora",
    school: "School of Engineering and Applied Science",
    department: "Computer Science",
    title: "Professor of Computer Science",
    email: "poorvi@gwu.edu",
    bio: "Cryptography, election security, and privacy.",
    profile_url: "https://example.gwu.edu/poorvi.vora",
    image_url: null,
    research_interests: ["Cryptography", "Election security", "Privacy"],
  },
  {
    name: "Tim Wood",
    school: "School of Engineering and Applied Science",
    department: "Computer Science",
    title: "Associate Professor of Computer Science",
    email: "timwood@gwu.edu",
    bio: "Cloud computing, distributed systems, and networking.",
    profile_url: "https://example.gwu.edu/tim.wood",
    image_url: null,
    research_interests: ["Cloud computing", "Distributed systems", "Networking"],
  },
  {
    name: "Guru Venkataramani",
    school: "School of Engineering and Applied Science",
    department: "Electrical and Computer Engineering",
    title: "Professor of Electrical and Computer Engineering",
    email: "guruv@gwu.edu",
    bio: "Computer architecture, hardware security, and performance.",
    profile_url: "https://example.gwu.edu/guru.venkataramani",
    image_url: null,
    research_interests: ["Computer architecture", "Hardware security"],
  },
  {
    name: "Claire Monteleoni",
    school: "Columbian College of Arts and Sciences",
    department: "Computer Science",
    title: "Associate Professor of Computer Science",
    email: "cmontel@gwu.edu",
    bio: "Machine learning for climate informatics.",
    profile_url: "https://example.gwu.edu/claire.monteleoni",
    image_url: null,
    research_interests: ["Machine learning", "Climate informatics"],
  },
];

function loadFaculty() {
  if (existsSync(DETAILS_PATH)) {
    const raw = JSON.parse(readFileSync(DETAILS_PATH, "utf-8"));
    console.log(`Seeding from scraped data: ${raw.length} records.`);
    return raw;
  }
  console.log("No data/faculty_details.json found — using sample faculty.");
  return SAMPLE_FACULTY;
}

async function main() {
  const records = loadFaculty();
  let created = 0;

  for (const r of records) {
    if (!r.profile_url) continue; // profileUrl is required + unique
    const interests = Array.isArray(r.research_interests)
      ? r.research_interests.filter(Boolean)
      : [];

    const base = {
      name: r.name ?? "Unknown",
      school: r.school ?? null,
      department: r.department ?? null,
      title: r.title ?? null,
      email: r.email ?? null,
      bio: r.bio ?? null,
      imageUrl: r.image_url ?? null,
    };

    const faculty = await prisma.faculty.upsert({
      where: { profileUrl: r.profile_url },
      update: base,
      create: { ...base, profileUrl: r.profile_url },
    });

    // Reset + reconnect interests so re-seeding stays consistent.
    await prisma.facultyResearchInterest.deleteMany({
      where: { facultyId: faculty.id },
    });
    for (const name of interests) {
      const interest = await prisma.researchInterest.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      await prisma.facultyResearchInterest.create({
        data: { facultyId: faculty.id, researchInterestId: interest.id },
      });
    }
    created += 1;
  }

  const interestCount = await prisma.researchInterest.count();
  console.log(`Done. ${created} faculty upserted, ${interestCount} distinct interests.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
