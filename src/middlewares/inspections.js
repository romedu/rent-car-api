const dbPool = require("../model"),
	{ createError } = require("../utils");

// Finds the current rent based on the req.body's rentId property
exports.getCurrentRent = (req, res, next) => {
	const { rentId } = req.body,
		currentRentQuery = `
            SELECT client_id AS renterId, returned_at AS returnedAt
            FROM rent WHERE id = "${rentId}";
         `;

	dbPool.query(currentRentQuery, (error, rentResult) => {
		if (error) return next(error);
		const rentData = JSON.parse(JSON.stringify(rentResult))[0];
		// If no rent was found with the passed id send an error
		if (!rentData) {
			error = createError(404);
			return next(error);
		}
		req.locals.currentRent = { ...rentData };
		next();
	});
};

// Check if the one inspecting the vehicle is the one who rented it
exports.checkIfIsRenter = (req, res, next) => {
	const { currentRent, currentUserId } = req.locals;
	if (currentRent.renterId === currentUserId) return next();
	else {
		const error = createError(401);
		return next(error);
	}
};

// Check if the vehicle is currently rented
// Even though the rented vehicle is suppossed to be inspected before returning it and the next middleware will stop the request,
// this one saves the need to make an extra query :D
exports.checkIfRented = (req, res, next) => {
	const { currentRent } = req.locals;

	// If the rent was already returned send an error
	if (currentRent.returnedAt) {
		const error = createError(400, "Rent was already returned");
		return next(error);
	}
	return next();
};

exports.checkIfNotInspected = (req, res, next) => {
	const { rentId } = req.body,
		rentCountQuery = `SELECT COUNT(*) as rentCount FROM inspection WHERE rent_id = "${rentId}";`;

	dbPool.query(rentCountQuery, (error, rentCountResult) => {
		if (error) return next(error);
		const { rentCount } = JSON.parse(JSON.stringify(rentCountResult))[0];
		// If the count is greater than 0 it was inspected already
		if (!rentCount) return next();
		else {
			error = createError(400, "Vehicle was inspected already");
			return next(error);
		}
	});
};

module.exports = exports;
