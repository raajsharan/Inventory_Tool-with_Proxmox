const svc = require('../services/agentPushService');
const ApiError = require('../utils/ApiError');

async function listAssets(req, res, next) {
  try { res.json({ assets: await svc.listEligibleAssets() }); } catch (e) { next(e); }
}

async function listLocations(req, res, next) {
  try { res.json({ locations: await svc.listLocations() }); } catch (e) { next(e); }
}

async function createLocation(req, res, next) {
  try { res.json(await svc.createLocation(req.body, req.user.id)); } catch (e) { next(e); }
}

async function deleteLocation(req, res, next) {
  try { res.json(await svc.deleteLocation(req.params.id)); } catch (e) { next(e); }
}

async function uploadPackage(req, res, next) {
  try {
    const os = req.body.os || req.query.os;
    if (!req.files?.length) throw new ApiError(400, 'At least one file is required');
    res.json(await svc.uploadLocationPackage(req.params.id, os, req.files));
  } catch (e) { next(e); }
}

async function uploadResponseIss(req, res, next) {
  try { res.json(await svc.uploadResponseIss(req.files)); } catch (e) { next(e); }
}

async function createJob(req, res, next) {
  try { res.json(await svc.createJob(req.body, req.user.id)); } catch (e) { next(e); }
}

async function listJobs(req, res, next) {
  try { res.json({ jobs: await svc.listJobs() }); } catch (e) { next(e); }
}

async function getJob(req, res, next) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) throw new ApiError(404, 'Job not found');
    res.json(job);
  } catch (e) { next(e); }
}

async function getJobStatus(req, res, next) {
  try { res.json(await svc.getJobStatus(req.params.id)); } catch (e) { next(e); }
}

module.exports = {
  listAssets, listLocations, createLocation, deleteLocation, uploadPackage, uploadResponseIss,
  createJob, listJobs, getJob, getJobStatus,
};
