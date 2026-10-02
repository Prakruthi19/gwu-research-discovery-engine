-- CreateTable
CREATE TABLE "Faculty" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "school" TEXT,
    "department" TEXT,
    "title" TEXT,
    "email" TEXT,
    "bio" TEXT,
    "profileUrl" TEXT NOT NULL,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Faculty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchInterest" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ResearchInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyResearchInterest" (
    "facultyId" INTEGER NOT NULL,
    "researchInterestId" INTEGER NOT NULL,

    CONSTRAINT "FacultyResearchInterest_pkey" PRIMARY KEY ("facultyId","researchInterestId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Faculty_profileUrl_key" ON "Faculty"("profileUrl");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchInterest_name_key" ON "ResearchInterest"("name");

-- AddForeignKey
ALTER TABLE "FacultyResearchInterest" ADD CONSTRAINT "FacultyResearchInterest_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyResearchInterest" ADD CONSTRAINT "FacultyResearchInterest_researchInterestId_fkey" FOREIGN KEY ("researchInterestId") REFERENCES "ResearchInterest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
