# Notes

Documentation and analysis for the WebRun VCS project.

## Instructions

* For each issue found during the execution, create a corresponding Beads bug / task / issue with a detailed description of what needs to be done.
* Before going to the next Beads epic, implement the current one, test it, typecheck, lint, format, commit and push (`bd sync`).
* After each completed Beads epic analyse all open issues and bugs non-attached to any epics, and check if they can be groupped in epics - existing or new once. If yes, attach them and update their description if needed.


* After each completed Beads epic, update this document with references to the corresponding epics and tasks, and add any relevant notes about the implementation process, any challenges faced, and how they were overcome.


### Implementation Instructions

* Implement open epics with all associated tasks
* Test all new features thoroughly
* Use separate branches/worktrees for parallel work by multiple agents
* After completing work in a branch/worktree: lint, format, commit, merge to main, and delete the branch
* Create Beads issues for any problems found during execution
* Complete, test, typecheck, lint, format, commit, and push each epic before starting the next (`bd sync`)
* After each epic: review open unattached issues and group them into new or existing epics
* Maintain a separate note document tracking implementation progress
* Update this document after each epic with: epic/task references, implementation notes, challenges, and solutions
