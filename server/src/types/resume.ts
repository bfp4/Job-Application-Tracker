/**
 * Structured representation of a resume.
 *
 * Both BaseResume.content and TailoredResume.tailoredContent are stored as JSON
 * matching this shape. The AI parser (resumeParser) produces it from raw PDF
 * text, and the AI tailor (resumeTailor) rewrites it for a specific job while
 * preserving the exact same shape.
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

export interface ResumeLeadership {
  organization: string;
  role: string;
  startDate: string;
  endDate: string | null;
  bullets: string[];
}

export interface ResumeStructure {
  personalInfo: ResumePersonalInfo;
  summary: string | null;
  experience: ResumeExperience[];
  education: ResumeEducation[];
  skills: ResumeSkills;
  projects: ResumeProject[];
  leadership: ResumeLeadership[];
}
