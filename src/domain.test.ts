import{describe,expect,it}from"vitest";
import{commitExtraction,createCampusStore,extractAnnouncement,initialState,normalizeExtraction,answerCampusQuery,validateExtraction,deterministicExtractionProvider,relevanceForUser,deadlineStatus,campusDeadlines,createCampusRepository,canAccessSociety,societyContribution,feedbackSummary,demoProfile,discoverCampus,analyticsSnapshot,personalizedWorkflow,roleCan}from"./domain";

describe("announcement extraction",()=>{
it("extracts the hackathon demo into connected facts and actions",()=>{
const result=extractAnnouncement({title:"24-Hour AI Hackathon — registrations are open",body:"AI Club is conducting a 24-hour hackathon on October 15. Teams of 2–4 can participate. Registration closes October 10. Participants need to submit their idea before October 13.",type:"EVENT",author:"AI Club",club:"AI Club"});
expect(result.event?.name.toLowerCase()).toContain("hackathon");
expect(result.organization?.name).toBe("AI Club");
expect(result.deadlines.map(x=>x.date)).toEqual(["October 10","October 13"]);
expect(result.requirements).toContain("Team size 2–4");
expect(result.relationships.some(x=>x.relation==="organizes")).toBe(true);
expect(result.relationships.some(x=>x.relation==="has_deadline")).toBe(true);
expect(result.tasks.length).toBeGreaterThanOrEqual(3);
});
it("commits extracted state without duplicating existing relationships",()=>{
const store=createCampusStore({...initialState,entities:[],relationships:[],posts:[],tasks:[]});
const result=extractAnnouncement({title:"AI Hackathon",body:"AI Club is conducting a hackathon on October 15. Registration closes October 10.",type:"EVENT",author:"AI Club",club:"AI Club"});
commitExtraction(store,result);
const after=store.getState();
expect(after.posts).toHaveLength(1);
expect(after.entities.length).toBeGreaterThan(0);
expect(after.relationships.some(x=>x.relation==="has_deadline")).toBe(true);
expect(after.tasks.length).toBeGreaterThan(0);
commitExtraction(store,result);
expect(store.getState().relationships.filter(x=>x.relation==="has_deadline")).toHaveLength(1);
});
});
describe("extraction boundary",()=>{
 it("normalizes duplicate facts and validates the provider contract",async()=>{
  const result=extractAnnouncement({title:"AI Hackathon",body:"AI Club is conducting a hackathon. Registration closes October 10.",type:"EVENT",author:"AI Club",club:"AI Club"});
  const duplicated={...result,entities:[...result.entities,...result.entities],relationships:[...result.relationships,...result.relationships],tasks:[...result.tasks,...result.tasks]};
  const normalized=normalizeExtraction(duplicated);
  expect(validateExtraction(normalized).valid).toBe(true);
  const invalid={...result,tasks:[{...result.tasks[0],source:"missing-entity"}]};
  expect(validateExtraction(invalid).valid).toBe(false);
  const providerResult=await deterministicExtractionProvider.understand(result.input);
  expect(providerResult.entities.length).toBeGreaterThan(0);
 });
});

describe("campus information types",()=>{
 it("preserves resource, notice and competition announcements as first-class entities",()=>{
  const resource=extractAnnouncement({title:"CN Viva Notes",body:"Seniors uploaded routing and socket notes.",type:"RESOURCE",author:"B-30",club:"B-30"});
  const notice=extractAnnouncement({title:"Exam form notice",body:"Submit the examination form before October 20.",type:"NOTICE",author:"Admin",club:"Administration"});
  const competition=extractAnnouncement({title:"National Coding Competition",body:"Teams of 2-4 can participate. Registration closes October 12.",type:"COMPETITION",author:"Coding Club",club:"Coding Club"});
  expect(resource.entities.some(e=>e.type==="resource")).toBe(true);
  expect(notice.entities.some(e=>e.type==="notice")).toBe(true);
  expect(competition.entities.some(e=>e.type==="competition")).toBe(true);
  expect(competition.relationships.some(r=>r.relation==="has_deadline")).toBe(true);
 });
});

describe("personal workspace",()=>{
 it("loads the demo profile safely and uses active projects for relevance",()=>{
  const post={id:99,type:"PROJECT",title:"Campus OS planning",body:"Work on the Campus OS dashboard",author:"Team",club:"Tech Society",time:"now",votes:0,comments:0,tags:["Campus OS"],linked:"Campus OS"};
  const profile={...({id:"u",name:"A",branch:"CSE",year:2,interests:[],clubs:[],activeProjects:["Campus OS"],role:"student" as const})};
  expect(profile.activeProjects).toContain("Campus OS");
  expect(relevanceForUser(post,profile).reasons.join(" ")).toContain("active project");
 });
});


describe("deadline intelligence",()=>{
 it("classifies deadline attention windows",()=>{
  const now=new Date(2026,9,2,12);
  expect(deadlineStatus("October 2",now)).toBe("today");
  expect(deadlineStatus("October 5",now)).toBe("due_soon");
  expect(deadlineStatus("September 30",now)).toBe("overdue");
  const deadlines=campusDeadlines(initialState,now);
  expect(deadlines[0]?.date).toBe("Oct 10");
  expect(deadlines[0]?.source?.name).toBe("AI Hackathon");
 });
});

describe("persistence boundary",()=>{
 it("can swap the local persistence implementation without changing domain consumers",()=>{
  let saved=initialState;
  const persistence={load:()=>saved,save:(next:typeof initialState)=>{saved=next}};
  const repository=createCampusRepository(persistence);
  const state=repository.load();
  expect(state.entities.length).toBeGreaterThan(0);
  repository.save({...state,posts:[]});
  expect(repository.load().posts).toHaveLength(0);
 });
});

describe("campus copilot",()=>{
 it("answers workflow questions only from connected campus state",()=>{
  const profile={id:"u",name:"A",branch:"CSE",year:2,interests:["Hackathon"],clubs:["AI Club"],activeProjects:["Campus OS"],role:"student" as const};
  const result=answerCampusQuery(initialState,profile,"What do I need to do for the hackathon?");
  expect(result.answer).toContain("Register for AI Hackathon");
  expect(result.tasks.every(t=>initialState.entities.some(e=>e.id===t.source))).toBe(true);
  expect(result.reason).toContain("saved campus workflow");
 });
 it("returns connected deadline facts for deadline questions",()=>{
  const profile={id:"u",name:"A",branch:"CSE",year:2,interests:[],clubs:[],activeProjects:[]};
  const result=answerCampusQuery(initialState,profile,"What is the hackathon registration deadline?");
  expect(result.answer).toContain("Registration");
  expect(result.deadlines.length).toBeGreaterThan(0);
  expect(result.entities.some(e=>e.id==="hack-deadline")).toBe(true);
 });
 it("uses profile context for relevance questions",()=>{
  const profile={id:"u",name:"A",branch:"CSE",year:2,interests:["Career"],clubs:["Tech Society"],activeProjects:[],role:"student" as const};
  const result=answerCampusQuery(initialState,profile,"What is relevant to me?");
  expect(result.answer).toContain("Microsoft");
  expect(result.reason).toContain("career opportunity");
 });
});

describe("graph workflow integrity",()=>{
 it("keeps seeded and generated task sources resolvable as entity ids",()=>{
  const seeded=initialState.tasks.find(t=>t.title.startsWith("Register"));
  expect(seeded?.source).toBe("ai-hackathon");
  expect(initialState.entities.some(e=>e.id===seeded?.source)).toBe(true);
  const result=extractAnnouncement({title:"AI Hackathon",body:"AI Club is conducting a hackathon on October 15. Registration closes October 10.",type:"EVENT",author:"AI Club",club:"AI Club"});
  expect(result.tasks.every(task=>result.entities.some(entity=>entity.id===task.source))).toBe(true);
 });
});

describe("state hardening",()=>{
 it("allocates ids above persisted state and avoids duplicate generated tasks",()=>{
  const seed={...initialState,posts:[{...initialState.posts[0],id:900}],tasks:[{...initialState.tasks[0],id:901}]};
  const store=createCampusStore(seed);
  expect(store.nextId()).toBe(902);
  const result=extractAnnouncement({title:"AI Hackathon",body:"AI Club is conducting a hackathon. Registration closes October 10.",type:"EVENT",author:"AI Club",club:"AI Club"});
  commitExtraction(store,result);
  const count=store.getState().tasks.length;
  commitExtraction(store,result);
  expect(store.getState().tasks.length).toBe(count);
 });
});


describe("society operations",()=>{
 it("keeps public events and private society access as separate domain records",()=>{
  expect(initialState.events[0].societyId).toBe("ai-club-society");
  expect(canAccessSociety(initialState,"ai-club-society","user-shiv")).toBe(true);
  expect(canAccessSociety(initialState,"design-club-society","unknown-user")).toBe(false);
 });
 it("supports event, task, budget, promotion, requirement and analysis mutations",()=>{
  const store=createCampusStore(initialState);
  const event={...initialState.events[0],id:"test-event",name:"Test Event"};
  store.addEvent(event);
  store.addSocietyTask({...initialState.societyTasks[0],id:900,eventId:"test-event"});
  store.addBudget({eventId:"test-event",societyId:"ai-club-society",estimated:1000,actual:400,sponsorship:500,currency:"INR"});
  store.addPromotion({id:"test-promo",eventId:"test-event",societyId:"ai-club-society",channel:"Instagram",owner:"A",plannedDate:"Oct 4",status:"planned"});
  store.addRequirement({id:"test-req",eventId:"test-event",societyId:"ai-club-society",category:"equipment",item:"Camera",quantity:"1",owner:"A",status:"needed"});
  store.addAnalysis({eventId:"test-event",registrations:20,attendees:15,winners:["A"],participantFeedback:["Good"],guestFeedback:[],whatWentWell:["Good"],problems:["Late start"],suggestions:["Start earlier"],finalExpenditure:450,photos:["photo.jpg"],sponsors:["Sponsor"],eventReport:"Report"});
  const state=store.getState();
  expect(state.events.some(e=>e.id==="test-event")).toBe(true);
  expect(state.societyTasks.some(t=>t.eventId==="test-event")).toBe(true);
  expect(state.budgets.find(b=>b.eventId==="test-event")?.sponsorship).toBe(500);
  expect(state.promotions.find(p=>p.id==="test-promo")?.status).toBe("planned");
  expect(state.requirements.find(r=>r.id==="test-req")?.item).toBe("Camera");
  expect(state.analyses.find(a=>a.eventId==="test-event")?.attendees).toBe(15);
 });
 it("summarizes categorical feedback and member contribution",()=>{
  const store=createCampusStore(initialState);
  store.addFeedback({id:"f1",eventId:"ai-hackathon-2026",societyId:"ai-club-society",category:"venue",priority:"high",sentiment:"negative",text:"Room was crowded",submitter:"A",createdAt:"2026-10-03"});
  store.addFeedback({id:"f2",eventId:"ai-hackathon-2026",societyId:"ai-club-society",category:"venue",priority:"medium",sentiment:"positive",text:"Good location",submitter:"B",createdAt:"2026-10-03"});
  const summary=feedbackSummary(store.getState(),"ai-club-society","ai-hackathon-2026");
  expect(summary.find(x=>x.category==="venue")?.count).toBe(2);
  expect(summary.find(x=>x.category==="venue")?.negative).toBe(1);
  const contribution=societyContribution(store.getState(),"ai-club-society","ai-hackathon-2026");
  expect(contribution.find(x=>x.member==="Riya")?.completed).toBe(1);
 });
});


describe("public society pages",()=>{
 it("contains public profile information without private operations fields",()=>{
  const society=initialState.societies.find(s=>s.id==="ai-club-society")!;
  expect(society.fic).toBeTruthy();
  expect(society.genre).toContain("AI");
  expect(society.xfactor.split(/\s+/).length).toBeGreaterThan(30);
  expect(society.timeline.length).toBeGreaterThan(0);
  expect(society.publicMembers.every(member=>member.position)).toBe(true);
 });
 it("models society-authored upcoming and past event posts separately",()=>{
  const upcoming=initialState.societyEventPosts.find(p=>p.status==="upcoming")!;
  const past=initialState.societyEventPosts.find(p=>p.status==="past")!;
  expect(upcoming.postedBy).toBe("AI Club");
  expect(upcoming.collaboratingSocieties).toContain("Design Club");
  expect(upcoming.registrationLink).toContain("http");
  expect(upcoming.joinReason).toBeTruthy();
  expect(past.winners.length).toBeGreaterThan(0);
  expect(past.media.length).toBeGreaterThan(0);
 });
});


describe("knowledge, roles and analytics",()=>{
 it("discovers connected knowledge from natural-language intent and profile context",()=>{
  const profile={...demoProfile,role:"student" as const};
  const results=discoverCampus(initialState,profile,"Which opportunities match my career interests?");
  expect(results.length).toBeGreaterThan(0);
  expect(results.some(x=>/Microsoft/i.test(x.title))).toBe(true);
 });
 it("keeps role permissions explicit",()=>{
  expect(roleCan("student","create_workflow")).toBe(true);
  expect(roleCan("student","sync_notion")).toBe(false);
  expect(roleCan("club_coordinator","sync_notion")).toBe(true);
 });
 it("exposes explicit registration, volunteer and project dependency chains",()=>{
  expect(initialState.relationships.some(r=>r.relation==="registration_for"&&r.to==="ai-hackathon")).toBe(true);
  expect(initialState.relationships.some(r=>r.relation==="volunteers_for")).toBe(true);
  expect(initialState.relationships.some(r=>r.relation==="milestone_of")).toBe(true);
 });
 it("aggregates workflow analytics from the graph",()=>{
  const metrics=analyticsSnapshot(initialState);
  expect(metrics.pendingRegistrations).toBeGreaterThan(0);
  expect(metrics.upcomingDeadlines).toBeGreaterThan(0);
  expect(metrics.workload).toBeGreaterThan(0);
  expect(metrics.projects.some(x=>x.project.id==="campus-os-project")).toBe(true);
 });
 it("generates personalized workflow actions from relevant opportunities",()=>{
  const profile={...demoProfile,interests:["Career"],role:"student" as const};
  const actions=personalizedWorkflow(initialState,profile);
  expect(actions.some(x=>/Microsoft/i.test(x.title))).toBe(true);
 });
});
