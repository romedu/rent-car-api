const nodemailer = require("nodemailer"),
	dbPool = require("../model"),
	{ convertToWhereClause, createError } = require("../utils");

exports.findAll = (req, res, next) => {
	const { page = 1, ...queryParams } = req.query,
		//If there isn't any query params, omit the where clause
		whereClause = Object.keys(queryParams).length
			? `WHERE ${convertToWhereClause(queryParams)}`
			: "",
		query = `
         SELECT rent.id, DATE_FORMAT(rent.rented_at, '%e/%m/%Y') AS rentedAt, rent.rent_days AS rentDays, 
                vehicle.built_year AS builtYear, vehicle_image.front_image AS frontImage, model.description AS model, 
                make.description AS make 
         FROM rent
         INNER JOIN vehicle
         ON rent.vehicle_id = vehicle.id
         INNER JOIN vehicle_image
         ON vehicle_image.vehicle_id = vehicle.id
         INNER JOIN model
         ON model.id = vehicle.model_id
         INNER JOIN make
         ON make.id = model.make_id
         ${whereClause}
         ORDER BY vehicle.rents
         LIMIT 10
         OFFSET ${page * 10 - 10};
      `;

	dbPool.query(query, (error, results) => {
		if (error) return next(error);
		const rents = JSON.parse(JSON.stringify(results)), // Convert from array-like-object to array
			responseData = {
				page,
				data: rents
			};

		return res.status(200).json(responseData);
	});
};

// Creates a rent and bump the current vehicle's rent property
exports.create = (req, res, next) => {
	const { vehicleId, rentDays, commentary = "", employeeId } = req.body,
		{ currentUserId, currentVehicle } = req.locals,
		// The vehicle's rent_price is used to calculate the rent fee
		createRentQuery = `
         INSERT INTO rent(rent_days, commentary, fee, employee_id, client_id, vehicle_id)
         VALUES (
                  ${rentDays},
                  "${commentary}",
                  ${rentDays * currentVehicle.rentPrice},
                  ${employeeId},
                  ${currentUserId},
                  ${vehicleId}
               );
      `;

	// Bump the rented vehicles rent value and make it unavaible
	dbPool.query(createRentQuery, (error, rentResult) => {
		if (error) return next(error);

		const vehicleUpdateQuery = `
               UPDATE vehicle 
               SET rents = ${currentVehicle.rents} + 1,
                  available = false
               WHERE id = "${vehicleId}";
            `;

		dbPool.query(vehicleUpdateQuery, error => {
			if (error) return next(error);
			const { insertId: rentId } = JSON.parse(JSON.stringify(rentResult));
			return res.status(201).json({ rentId });
		});
	});
};

exports.findOne = (req, res, next) => {
	const { id: rentId } = req.params,
		query = `
         SELECT rent.id, DATE_FORMAT(rent.rented_at, '%e/%m/%Y') AS rentedAt, DATE_FORMAT(rent.returned_at, '%e/%m/%Y') AS returnedAt, 
                rent.rent_days AS rentDays, rent.commentary, rent.fee, rent.available, rent.vehicle_id AS vehicleId, 
                vehicle.built_year AS builtYear, vehicle_image.front_image AS frontImage, model.description AS model, 
                make.description AS make, client.name AS clientName, employee.name as employee
         FROM rent
         INNER JOIN vehicle
         ON rent.vehicle_id = vehicle.id
         INNER JOIN vehicle_image
         ON vehicle_image.vehicle_id = vehicle.id
         INNER JOIN model
         ON model.id = vehicle.model_id
         INNER JOIN make
         ON make.id = model.make_id
         INNER JOIN client
         ON client.id = rent.client_id
         INNER JOIN employee
         ON employee.id = rent.employee_id
         WHERE rent.id = "${rentId}";
      `;

	dbPool.query(query, (error, results) => {
		if (error) return next(error);
		const rent = JSON.parse(JSON.stringify(results))[0]; // Convert from array-like-object to array, and take the first and "only" result
		// If no rent matches the id passed in the params, throw a not found error
		if (!rent) {
			error = createError(404);
			return next(error);
		}
		return res.status(200).json({ rent });
	});
};

// Sets the current date as the returned_at date for the rent entity and makes the rented vehicle available
exports.returnRent = (req, res, next) => {
	const { id: rentId } = req.params,
		// The currentDate value gets converted to the equivalent of a timestamp in mysql, e.g. "2017-06-29 17:54:04"
		currentDate = new Date()
			.toISOString()
			.slice(0, 19)
			.replace("T", " "),
		query = `UPDATE rent set returned_at = "${currentDate}" where id = "${rentId}";`;

	// Make the vehicle avaible after it was returned
	dbPool.query(query, error => {
		if (error) return next(error);
		const { id: rentedVehicleId } = req.locals.currentVehicle,
			vehicleUpdateQuery = `
               UPDATE vehicle SET available = true
               WHERE id = "${rentedVehicleId}";
            `;

		dbPool.query(vehicleUpdateQuery, error => {
			if (error) return next(error);
			return res.status(200).json({ message: "Rent updated successfully" });
		});
	});
};

exports.sendMail = async (req, res, next) => {
	try {
		const { ...queryParams } = req.query,
			//If there isn't any query params, omit the where clause
			whereClause = Object.keys(queryParams).length
				? `WHERE ${convertToWhereClause(queryParams)}`
				: "",
			query = `
            SELECT rent.id, DATE_FORMAT(rent.rented_at, '%e/%m/%Y') AS rentedAt, rent.rent_days AS rentDays, 
            vehicle.built_year AS builtYear, vehicle_image.front_image AS frontImage, model.description AS model, 
            make.description AS make 
            FROM rent
            INNER JOIN vehicle
            ON rent.vehicle_id = vehicle.id
            INNER JOIN vehicle_image
            ON vehicle_image.vehicle_id = vehicle.id
            INNER JOIN model
            ON model.id = vehicle.model_id
            INNER JOIN make
            ON make.id = model.make_id
            ${whereClause}
            ORDER BY vehicle.rents
         `;

		dbPool.query(query, async (error, results) => {
			if (error) return next(error);
			const rents = JSON.parse(JSON.stringify(results)), // Convert from array-like-object to array
				{ EMAIL_HOST, EMAIL_PASSWORD } = process.env,
				transporter = nodemailer.createTransport({
					host: "Smtp.live.com",
					service: "Outlook",
					port: 587,
					secure: false,
					tls: {
						rejectUnauthorized: false
					},
					auth: {
						user: EMAIL_HOST,
						pass: EMAIL_PASSWORD
					}
				});

			try {
				const { email: emailReceiver } = req.body,
					mailOptions = {
						from: `"Rent-Car-App👻" ${EMAIL_HOST}`,
						to: emailReceiver,
						subject: `Rents Report`,
						text: rents.map(obj => JSON.stringify(obj)).join("\n\n")
					};

				if (!emailReceiver) throw createError(400, "Invalid email address");
				else await transporter.sendMail(mailOptions);

				return res
					.status(200)
					.json({ message: "The report was sent to your email" });
			} catch (error) {
				return next(error);
			}
		});
	} catch (error) {
		return next(error);
	}
};

module.exports = exports;
