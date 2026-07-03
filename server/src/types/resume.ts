/**
 * Structured representation of a resume, produced by the resume parser agent
 * from raw PDF text. Stored as BaseResume.parsed.
 */

export interface ResumePersonalInfo {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  location: string;
}

export interface ResumeExperience {
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string | null;
  bullets: string[];
}

export interface ResumeEducation {
  institution: string;
  degree: string;
  field: string;
  graduationDate: string;
}

export interface ResumeSkills {
  languages: string[];
  frontend: string[];
  backend: string[];
  databases: string[];
  tools: string[];
}

export interface ResumeProject {
  name: string;
  technologies: string[];
  bullets: string[];
}

export interface ResumeProfile {
  personalInfo: ResumePersonalInfo;
  summary: string | null;
  experience: ResumeExperience[];
  education: ResumeEducation[];
  skills: ResumeSkills;
  projects: ResumeProject[];
}
