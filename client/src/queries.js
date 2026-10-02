import { gql } from "@apollo/client";

// The main feature: search faculty by research field. Requests matchedInterests
// so the UI can highlight *which* interests caused the match (the stamped tags).
export const SEARCH_FACULTY = gql`
  query SearchFaculty($query: String!) {
    facultyBySearch(query: $query) {
      matchedInterests
      faculty {
        id
        name
        title
        department
        school
        email
        bio
        profileUrl
        imageUrl
        researchInterests {
          id
          name
        }
      }
    }
  }
`;

export const ALL_FACULTY = gql`
  query AllFaculty($department: String) {
    allFaculty(department: $department) {
      id
      name
      title
      department
      school
      email
      bio
      profileUrl
      imageUrl
      researchInterests {
        id
        name
      }
    }
  }
`;

export const ALL_DEPARTMENTS = gql`
  query AllDepartments {
    allDepartments
  }
`;

export const FACULTY_BY_ID = gql`
  query FacultyById($id: ID!) {
    facultyById(id: $id) {
      id
      name
      title
      department
      school
      bio
      profileUrl
      imageUrl
      researchInterests {
        id
        name
      }
    }
  }
`;
